import { db } from './firebase.js';
import { ref, onValue, set, get, push } from './lib/firebase-database.js';

// =========================================================================
// I. KONFIGURATION & STATISCHE VARIABLEN
// =========================================================================

/**
 * Statische Konfigurationen für das Puzzle und die Anwendung.
 */
const CONFIG = {
    PUZZLE: {
        IMAGE: "./shield.png",
        COLS: 3,
        ROWS: 3,
        get TOTAL_PIECES() { return this.COLS * this.ROWS; }
    },
    POPUP_TEXTS: {
        audio: {
            title: "Mikrofonnutzung zulassen?",
            message:
                "Diese Anwendung nutzt dein Mikrofon, um Sprachinteraktionen oder Audiofeedback zu ermöglichen. \n Die Aufnahmen werden nicht gespeichert oder an Dritte weitergegeben.\n Magst du den Zugriff erlauben?",
        },
        data: {
            title: "Datenspeicherung zulassen?",
            message:
                "Diese Anwendung kann deinen Puzzle-Fortschritt lokal auf deinem Gerät speichern, damit du später weiterspielen kannst. " +
                "Die Daten werden nicht an Dritte weitergegeben und können jederzeit über den Reset-Button gelöscht werden.\n\n" +
                "Möchtest du die Speicherung deines Fortschritts erlauben?",
        },
    }
};

/**
 * DOM-Elemente zur einfachen Referenzierung.
 * (Konsolidiert alle document.getElementById Aufrufe)
 */
const DOM = {
    permissionBtn: document.getElementById("permissionBtn"),
    game: document.getElementById("game"),
    piecesContainer: document.getElementById("pieces"),
    boardContainer: document.getElementById("board"),
    startScreen: document.getElementById("startScreen"),
    popupOverlay: document.getElementById("popupOverlay"),
    popupBox: document.getElementById("popupBox"),
    allowBtn: document.getElementById("allowBtn"),
    denyBtn: document.getElementById("denyBtn"),
    rememberChk: document.getElementById("rememberChk"),
    motionDot: document.getElementById("motionDot"),
    micReminder: document.getElementById("micReminder"),
    micText: document.getElementById("micText"),
    loadPuzzleBtn: document.getElementById("loadPuzzleBtn"),
    status: document.getElementById("status"),
    statusText: document.getElementById("statusText"),
    statusTime: document.getElementById("statusTime"),
    restartBtn: document.getElementById("restartBtn"),
    popupHead: document.getElementById("popupHead"),
    popupText: document.getElementById("popupText"),
    syncNotice: document.getElementById('syncNotice')
};

// Firebase Refs und Client-ID
const puzzleRef = ref(db, "puzzle/state");
const CLIENT_ID = crypto.randomUUID ? crypto.randomUUID() : ('client-' + Math.random().toString(36).slice(2));


// =========================================================================
// II. ZUSTANDSMANAGEMENT
// =========================================================================

/**
 * Mutabler Zustand der Anwendung.
 */
let STATE = {
    // Puzzle Zustand
    boardState: Array(CONFIG.PUZZLE.TOTAL_PIECES).fill(null),
    unplacedPieces: [],
    errors: 0,
    selectedPiece: null,

    // Zeitmessungen
    permissionTime: 0,
    overallTime: 0,
    endPermissionTime: 0,
    permissionPopupStartTime: 0,

    // Berechtigungen
    audioPermission: { granted: false, remember: false },
    dataPermission: { granted: false, remember: false },

    // Synchronisation
    lastUpdateLocal: 0,
    sessionCounter: 0,
};


// =========================================================================
// III. LOGGING & SESSION MANAGEMENT
// =========================================================================

function newSessionId() {
    return "S_Lap_Puzzle_" + STATE.sessionCounter++;
}

function getSessionId() {
    return localStorage.getItem("sessionId");
}

function getLogRef() {
    return ref(db, "study_logs/" + getSessionId());
}

/**
 * Protokolliert ein Ereignis in der Firebase-Datenbank.
 */
function logEvent(eventType, details = {}) {
    push(getLogRef(), {
        eventType,
        timestamp: Date.now(),
        device: "Laptop",
        ...details
    });
    console.log("[LOG]", eventType, details);
}

/**
 * Startet eine neue Study Session (erzeugt neue ID).
 */
async function startStudySession() {
    const newId = newSessionId();
    localStorage.setItem("sessionId", newId);
    const newSessionRef = ref(db, "study_logs/" + newId);

    await set(newSessionRef, {
        sessionId: newId,
        createdAt: Date.now(),
        note: "New participant started"
    });
}

/**
 * Beendet die aktuelle Study Session (löscht ID).
 */
async function endStudySession() {
    logEvent("session_complete");
    localStorage.removeItem("sessionId");
}

// =========================================================================
// IV. PUZZLE CORE LOGIK & RENDERING
// =========================================================================

/**
 * Erzeugt die leeren Slots auf dem Spielbrett.
 */
function buildEmptyPuzzle() {
    DOM.boardContainer.innerHTML = "";
    DOM.piecesContainer.innerHTML = "";

    for (let i = 0; i < CONFIG.PUZZLE.TOTAL_PIECES; i++) {
        const slot = document.createElement("div");
        slot.className = "slot";
        slot.dataset.index = i;

        slot.addEventListener("dragover", (e) => e.preventDefault());
        slot.addEventListener("drop", onDrop);

        DOM.boardContainer.appendChild(slot);
    }
}

/**
 * Erzeugt ein einzelnes Puzzleteil als DOM-Element.
 */
function makePiece(i) {
    const piece = document.createElement("div");
    piece.className = "piece clickable";
    piece.draggable = true;
    piece.dataset.piece = i;

    // Hintergrundbild und Position setzen
    const { IMAGE, COLS, ROWS } = CONFIG.PUZZLE;
    piece.style.backgroundImage = `url(${IMAGE})`;
    piece.style.backgroundSize = `${COLS * 100}px ${ROWS * 100}px`;
    piece.style.backgroundPosition = `${-(i % COLS) * 100}px ${-Math.floor(i / COLS) * 100}px`;

    piece.addEventListener("dragstart", (e) => {
        STATE.selectedPiece = piece;
        piece.classList.add("selected-piece");
        e.dataTransfer.setData("piece", i);
    });
    
    piece.addEventListener("dragend", () => {
        if (STATE.selectedPiece) {
            STATE.selectedPiece.classList.remove("selected-piece");
            STATE.selectedPiece = null;
        }
    });

    return piece;
}

/**
 * Erzeugt eine zufällige Anordnung der Puzzleteile im Teile-Container.
 */
function createScrambledPieces(order) {
    DOM.piecesContainer.innerHTML = "";
    order.forEach((i) => {
        const piece = makePiece(i);
        DOM.piecesContainer.appendChild(piece);
    });
}

/**
 * Initialisiert das Puzzle-Spielbrett und die Teile für einen neuen Start.
 */
async function initPuzzle() {
    buildEmptyPuzzle();

    const totalPieces = CONFIG.PUZZLE.TOTAL_PIECES;
    const order = [...Array(totalPieces).keys()].sort(() => Math.random() - 0.5);

    createScrambledPieces(order);
    STATE.unplacedPieces = order;
    // Setze boardState auf Initialzustand zurück
    STATE.boardState.fill(null);
}

/**
 * Handler für das Ablegen eines Puzzleteils auf einem Slot (Drag & Drop).
 */
function onDrop(e) {
    e.preventDefault();
    const slotIndex = parseInt(e.currentTarget.dataset.index);
    const pieceIndex = parseInt(e.dataTransfer.getData("piece"));
    const piece = document.querySelector(`.piece[data-piece="${pieceIndex}"]`);

    // Slot ist bereits belegt
    if (STATE.boardState[slotIndex] !== null) return;

    if (pieceIndex === slotIndex) {
        // Richtige Position
        STATE.boardState[slotIndex] = pieceIndex;

        const indexToRemove = STATE.unplacedPieces.indexOf(pieceIndex);
        if (indexToRemove > -1) {
            STATE.unplacedPieces.splice(indexToRemove, 1);
        }

        e.currentTarget.appendChild(piece); // Teil in den Slot verschieben
        piece.draggable = false;
        piece.style.cursor = "default";

        savePuzzleState();
        checkSolved();
    } else {
        // Falsche Position
        STATE.errors++;
        logEvent("error", {
            type: "wrong_answer",
            error_nbr: STATE.errors,
            pieceIndex: pieceIndex,
            slotIndex: slotIndex
        });

        e.currentTarget.classList.add("wrong");
        setTimeout(() => e.currentTarget.classList.remove("wrong"), 300);
    }
}

/**
 * Prüft, ob das Puzzle gelöst wurde und zeigt den Endstatus an.
 */
function checkSolved() {
    const solved = STATE.boardState.every((val, idx) => val === idx);
    
    if (!solved) return;

    const endTime = Date.now();
    const permissonDuration = ((STATE.endPermissionTime - STATE.permissionTime) / 1000).toFixed(2);
    const puzzleDuration = ((endTime - STATE.overallTime) / 1000).toFixed(2);
    const totalDuration = ((endTime - STATE.permissionTime) / 1000).toFixed(2);

    DOM.status.style.display = "block";
    DOM.statusText.textContent = "Du hast das Puzzle erfolgreich gelöst! Du kannst das Puzzle über den Neustart-Button erneut beginnen.";
    DOM.statusTime.textContent = `Zeit: ${STATE.errors} Fehler`;
    
    DOM.restartBtn.onclick = restartGame; // Direkte Zuweisung, vermeidet Doppel-Listener
    
    savePuzzleState({ solved: true });
    console.log(totalDuration, puzzleDuration, permissonDuration);    

    logEvent("puzzle_solved", { 
        duration: puzzleDuration, 
        overallDuration: totalDuration, // Gesamtzeit im Log
        permissonDuration: permissonDuration, // Berechtigungszeit im Log
        errors: STATE.errors 
    });
}


// =========================================================================
// V. PUZZLE STATE SYNCHRONISIERUNG (NUR MANUELL/SPEICHERN)
// =========================================================================

/**
 * Speichert den aktuellen Puzzle-Zustand in Firebase.
 * @param {object} additionalPayload Zusätzliche Daten, z.B. { solved: true }.
 */
async function savePuzzleState(additionalPayload = {}) {
    
    // Prüft, ob die Datenspeicherung erlaubt ist.
    if (!STATE.dataPermission.granted) {
        console.warn('[SYNC] Save skipped: Data permission not granted.');
        showSyncNotice("Speichern fehlgeschlagen: Datenspeicherung nicht erlaubt."); 
        return;
    }
    
    // Stellt sicher, dass das Array dicht ist, bevor es gespeichert wird
    const board = STATE.boardState.map(v => (v === null ? null : v)); 

    const payload = {
        boardState: board, // boardState verwenden
        unplacedPieces: STATE.unplacedPieces,
        solved: STATE.boardState.every((v, i) => v === i),
        timestamp: Date.now(),
        source: CLIENT_ID,
        ...additionalPayload
    };
    try {
        await set(puzzleRef, payload);
        STATE.lastUpdateLocal = payload.timestamp;
        showSyncNotice();
        logEvent("puzzle_state_saved", { 
            placedCount: STATE.boardState.filter(v => v !== null).length, 
            isCompleted: payload.solved,
            timestamp: payload.timestamp
        });
    } catch (err) {
        console.warn('[SYNC] save failed', err);
    }
}
/**
 * Wandelt ein potenzielles Firebase-Objekt für boardState wieder in ein Array um.
 */
function coerceBoardState(remoteData, totalPieces) {
    let newBoardState = Array(totalPieces).fill(null);

    if (!remoteData || typeof remoteData !== 'object') {
        return newBoardState;
    }
    
    const sourceData = remoteData; 

    for (const key in sourceData) {
        const index = parseInt(key);
        
        if (!isNaN(index) && index >= 0 && index < totalPieces && sourceData.hasOwnProperty(key)) {
            const pieceId = sourceData[key];
            if (pieceId !== null) {
                newBoardState[index] = pieceId;
            }
        }
    }
    
    return newBoardState;
}
/**
 * Wendet einen externen (remote) Zustand an, falls dieser neuer ist.
 */
function applyRemoteStateIfNewer(remote) {

    if (!remote || !remote.timestamp) return;
    if (remote.source === CLIENT_ID) return; // Lokale Writes ignorieren
    if (remote.timestamp <= (STATE.lastUpdateLocal || 0)) return; // Ältere States ignorieren

    const totalPieces = CONFIG.PUZZLE.TOTAL_PIECES;

    // Gesamtzeit vom Remote-Status übernehmen
    if (remote.puzzleStartTime) {
        STATE.overallTime = remote.puzzleStartTime;
    }

    // 1. Lokalen Zustand aktualisieren: 
    // Nutzen der coerceBoardState-Funktion, die garantiert, dass
    // das resultierende Array die korrekte Größe (totalPieces) hat.
    STATE.boardState = coerceBoardState(remote.boardState, totalPieces);

    // 2. unplacedPieces neu ableiten oder aus Remote übernehmen
    if (Array.isArray(remote.unplacedPieces)) {
        STATE.unplacedPieces = remote.unplacedPieces.slice();
    } else {
        const placedPieceIds = new Set(STATE.boardState.filter(id => id !== null));
        STATE.unplacedPieces = [...Array(totalPieces).keys()].filter(id => !placedPieceIds.has(id));
        console.warn("Remote state missing valid unplacedPieces array. Deriving it...");
    }

    // 3. Puzzle neu rendern und Teile platzieren
    buildEmptyPuzzle();

    const allPieceIds = [...Array(totalPieces).keys()];
    const placedPieceIds = new Set();
    
    // Teile, die im boardState sind, auf das Brett verschieben
    STATE.boardState.forEach((pieceIndex, slotIndex) => {
        if (pieceIndex !== null) {
            placedPieceIds.add(pieceIndex);
            
            const slot = DOM.boardContainer.querySelector(`.slot[data-index="${slotIndex}"]`);
            const piece = makePiece(pieceIndex);

            piece.draggable = false;
            piece.style.cursor = "default";
            piece.classList.remove('clickable');

            slot.appendChild(piece);
        }
    });
    
    // 4. Verbleibende Teile im piecesContainer anzeigen
    const piecesToScramble = allPieceIds.filter(id => !placedPieceIds.has(id));
    // Der Einfachheit halber verwenden wir die abgeleitete oder geladene Liste:
    createScrambledPieces(STATE.unplacedPieces);
    
    // 5. Gelöst prüfen
    if (remote.solved) {
        checkSolved();
    }
    STATE.lastUpdateLocal = remote.timestamp;
}


// ❌ WICHTIG: Der onValue-Listener für die Echtzeit-Synchronisation wurde entfernt.
// Die Synchronisation findet jetzt nur manuell (über den Button) und beim Start statt.


// Button aktivieren (nur manuelle Synchronisation über 'get' beim Klick)
DOM.loadPuzzleBtn.addEventListener("click", async () => {

    //  Prüft, ob die Datenspeicherung erlaubt ist, bevor geladen wird.
    if (!STATE.dataPermission.granted) {
        showSyncNotice("Laden fehlgeschlagen: Datenspeicherung nicht erlaubt.");
        return;
    }
    const snap = await get(puzzleRef);
    if (snap.exists() && STATE.dataPermission.granted) {
        applyRemoteStateIfNewer(snap.val());
        logEvent("manual_puzzle_load", { ...snap.val() });
        showSyncNotice("Fortschritt manuell geladen.");
    } else {
        showSyncNotice("Kein Fortschritt zum Laden gefunden.");
    }
});


// =========================================================================
// VI. PERMISSIONS & POPUPS
// =========================================================================

/**
 * Zeigt die Synchronisations-Benachrichtigung an.
 */
function showSyncNotice(msg = "Fortschritt gespeichert") {
    const el = DOM.syncNotice;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 1200);
}

/**
 * Aktualisiert den visuellen Statuspunkt für die Berechtigungen.
 */
function updatePermissionDotCombined() {
    const bothGranted = STATE.audioPermission.granted && STATE.dataPermission.granted;
    const dot = DOM.motionDot;
    if (!dot) return;
    const allowed = dot.classList.contains("allowed");

    if (bothGranted && !allowed) {
        dot.classList.add("allowed", "pulse");
        setTimeout(() => dot.classList.remove("pulse"), 500);
    } else if (!bothGranted && allowed) {
        dot.classList.remove("allowed");
    }
    return bothGranted;
}

/**
 * Schreibt den aktuellen Berechtigungsstatus in Firebase.
 */
async function updatePermissionsInFirebase(type, granted, remember = false) {
    const refPath = `permission/${type}`;
    await set(ref(db, refPath), {
        permType: type,
        granted: granted,
        remember: remember,
        timestamp: new Date().toISOString(),
        source: "laptop"
    });
}

/**
 * Initialisiert Firebase-Listener, um Berechtigungsänderungen zu verfolgen.
 * (Bleibt aktiv, da Permissions von VR/Laptop aus geändert werden können)
 */
function initPermissionListeners() {
    const audioRef = ref(db, "permission/audio");
    const dataRef = ref(db, "permission/data");

    const handlePermissionChange = (type, val) => {
        if (!val) return;

        const permState = (type === "audio") ? STATE.audioPermission : STATE.dataPermission;
        permState.granted = val.granted;
        permState.remember = val.remember;
        
        updatePermissionDotCombined();
    };

    onValue(audioRef, snap => handlePermissionChange("audio", snap.val()));
    onValue(dataRef, snap => handlePermissionChange("data", snap.val()));
}

function allPermissionsDenied() {
    return !STATE.audioPermission.granted && !STATE.dataPermission.granted;
}

function allRememberDenied() {
    return !STATE.audioPermission.remember && !STATE.dataPermission.remember;
}

/**
 * Zeigt das Popup zur Berechtigungsabfrage an.
 */
function showPopup(type, title, message, onAllow, onDeny) {

    STATE.permissionPopupStartTime = Date.now();

    logEvent("popup_shown", {
        title: title,
        permissionType: type
    });

    DOM.popupOverlay.style.display = "block";
    DOM.popupBox.style.display = "block";
    DOM.popupHead.textContent = title;
    DOM.popupText.textContent = message;

    DOM.allowBtn.onclick = async () => {
        DOM.popupOverlay.style.display = "none";
        DOM.popupBox.style.display = "none";

        logEvent("permission_answer", {
            permissionType: type,
            granted: true,
            remember: DOM.rememberChk?.checked ?? false,
            responseTime: Date.now() - STATE.permissionPopupStartTime
        });

        if (onAllow) await onAllow();
    };

    DOM.denyBtn.onclick = async () => {
        DOM.popupOverlay.style.display = "none";
        DOM.popupBox.style.display = "none";

        logEvent("permission_answer", {
            permissionType: type,
            granted: false,
            remember: DOM.rememberChk?.checked ?? false,
            responseTime: Date.now() - STATE.permissionPopupStartTime
        });

        if (onDeny) await onDeny();
    };
}

/**
 * Fragt eine spezifische Berechtigung ab und speichert das Ergebnis.
 */
async function askPermission(type) {
    const { title, message } = CONFIG.POPUP_TEXTS[type];

    return new Promise((resolve) => {
        showPopup(
            type,
            title,
            message,
            async () => {
                const rememberValue = DOM.rememberChk.checked;
                await updatePermissionsInFirebase(type, true, rememberValue);
                resolve(true);
            },
            async () => {
                const rememberValue = DOM.rememberChk.checked;
                await updatePermissionsInFirebase(type, false, rememberValue);
                resolve(false);
            }
        );
    });
}

/**
 * Aktiviert einen pulsierenden Hinweis für das Mikrofon, falls die Berechtigung erteilt wurde.
 */
function pulseMic(active) {
    const micEl = DOM.micReminder;
    if (!micEl) return;
    
    if (active) {
        micEl.style.backgroundColor = "#f00";
        micEl.style.boxShadow = "0 0 10px rgba(255,0,0,0.5)";

        // Puls-Effekt (wie im Originalcode)
        setInterval(() => {
            micEl.style.opacity = (micEl.style.opacity == 1) ? 0 : 1;
        }, 1200);
    }
}

// =========================================================================
// VII. SPIELKONTROLLE (START/RESTART/RESET)
// =========================================================================

/**
 * Startet das Spiel und wechselt zur Spielansicht.
 */
async function startGame() {

    DOM.permissionBtn.style.display = "none";
    DOM.startScreen.style.display = "none";
    DOM.game.style.display = "block";
    DOM.loadPuzzleBtn.style.display = "block";
    
    // Zeitmessungen und Fehler/Selektion zurücksetzen
    STATE.endPermissionTime = Date.now();
    STATE.errors = 0;
    STATE.selectedPiece = null;

    // Mikrofon-Hinweis anzeigen
    if(STATE.audioPermission.granted){
        DOM.micText.style.opacity = "1";
        DOM.micReminder.style.opacity = "1";
        setTimeout(() => {
            DOM.micText.style.opacity="0";
        }, 2000);
    }

    // Puzzle-State aus Firebase laden (EINMALIGER GET-AUFRUF!)
    const snap = await get(puzzleRef);
    let stateInitialized = false;
    let remote=snap.val()
    

    if (snap.exists() && STATE.dataPermission.granted) {
        
        applyRemoteStateIfNewer(snap.val()); 
        stateInitialized = true;

        // Gesamtstartzeit vom Remote-Status übernehmen
        if (remote.puzzleStartTime) {
            STATE.overallTime = remote.puzzleStartTime;
            console.log("⏱ Gesamtzeit vom Remote-Status übernommen:", STATE.overallTime);
        }
    } 
    
    // Wenn der Zustand nicht geladen wurde oder leer ist, neu initialisieren
    if (!stateInitialized || (STATE.boardState.every(v => v === null) && STATE.unplacedPieces.length === 0)) {
        
       // Wenn die Zeit schon läuft (da sie nicht geladen werden durfte), läuft sie weiter.
        if (STATE.overallTime === 0) { 
            STATE.overallTime = Date.now();
            console.log("⏱ Gesamtzeit gestartet:", STATE.overallTime);
        }
        initPuzzle(); // Neues, gemischtes Puzzle starten

        // Neuen Zustand speichern (wenn Datenspeicherung erlaubt ist)
        if(STATE.dataPermission.granted) {
            // Gesamtstartzeit mitspeichern
            await savePuzzleState({ puzzleStartTime: STATE.overallTime }); 
        }
    }
}

/**
 * Setzt das gesamte Spiel zurück (UI, Permissions, Firebase-State).
 */
async function resetPuzzle() {
    // 1. Permissions zurücksetzen
    await updatePermissionsInFirebase('audio', false, false);
    await updatePermissionsInFirebase('data', false, false);

    // 2. Puzzle-State in Firebase zurücksetzen
    await set(puzzleRef, null);
    
    // 3. Lokalen State zurücksetzen
    STATE.boardState.fill(null);
    STATE.lastUpdateLocal = Date.now();
    STATE.unplacedPieces = [...Array(CONFIG.PUZZLE.TOTAL_PIECES).keys()];
    // 4. Puzzle UI neu initialisieren
    initPuzzle();
}

/**
 * Startet das Spiel neu nach dem Lösen (zurück zum Startbildschirm).
 */
async function restartGame() {

    // 1. UI zurücksetzen/wechseln
    DOM.status.style.display = "none";
    DOM.game.style.display = "none";
    DOM.startScreen.style.display = "block";
    DOM.statusText.textContent = "";
    DOM.statusTime.textContent = "";
    DOM.micText.style.opacity = "0";
    DOM.micReminder.style.opacity = "0";
    DOM.loadPuzzleBtn.style.display = "none";
    DOM.permissionBtn.style.display = "inline-block";

    // 2. Study Session beenden
    await endStudySession();

    // 3. Permissions zurücksetzen, wenn "Merken" nicht aktiv war
    if(!STATE.audioPermission.remember){
        STATE.audioPermission.granted = false; 
        await updatePermissionsInFirebase('audio', false, false);
    }
    if(!STATE.dataPermission.remember){
        STATE.dataPermission.granted = false; 
        await updatePermissionsInFirebase('data', false, false);
    }

    // 4. Puzzle-State in Firebase löschen (set auf null)
    await set(puzzleRef, null);

    console.log("Spiel neu gestartet. Zurück zur Startseite.");
}

// =========================================================================
// VIII. EVENT LISTENER
// =========================================================================

// Start-Button Handler: Verwaltet den Permission-Flow und startet das Spiel.
DOM.permissionBtn.addEventListener("click", async () => {
    STATE.permissionTime = Date.now();
    await startStudySession();
    
    logEvent("task_started", {
        permissionState: {
            audio: STATE.audioPermission,
            data: STATE.dataPermission
        }
    });

    const shouldAskAudio = !STATE.audioPermission.granted || !STATE.audioPermission.remember;
    const shouldAskData = !STATE.dataPermission.granted || !STATE.dataPermission.remember;

    if (shouldAskAudio && !STATE.audioPermission.remember) {
        await askPermission("audio");
    } else if (STATE.audioPermission.remember) {
         logEvent("popup_skipped_due_to_remember", { permissionType: "audio" });
    }
    
    if (shouldAskData && !STATE.dataPermission.remember) {
        await askPermission("data");
    } else if (STATE.dataPermission.remember) {
        logEvent("popup_skipped_due_to_remember", { permissionType: "data" });
    }
    
    pulseMic(STATE.audioPermission.granted);
    startGame();
});

// Reset-Button (MotionDot) Handler: Setzt alles zurück.
DOM.motionDot.addEventListener("click", resetPuzzle);


// =========================================================================
// IX. INITIALISIERUNG
// =========================================================================
initPermissionListeners();