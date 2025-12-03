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
            title: "Mikrofonzugriff erlauben?",
            message:
                "Diese Anwendung nutzt dein Mikrofon, um Audiofeedback zuzulassen. \n Die Aufnahmen werden nicht gespeichert oder an Dritte weitergegeben.\n Magst du den Zugriff erlauben?",
        },
        data: {
            title: "Datenspeicherung erlauben?",
            message:
                "Diese Anwendung kann deinen Puzzle-Fortschritt speichern, damit du zu einem anderen Zeitpunkt weiterspielen kannst.\n" +
                "Die Daten werden nicht an Dritte weitergegeben und sind jederzeit mit den Reset-Button widerrufbar.\n\n" +
                "Magst du die Speicherung deines Fortschritts erlauben?",
        },
    }
};

/**
 * DOM-Elemente zur einfachen Referenzierung in A-Frame.
 */
const DOM = {
    gamezone: document.getElementById('gamezone'),
    permissionBtn: document.getElementById('permissionBtn'),
    plane: document.getElementById('plane'),
    startEntity: document.getElementById('startEntity'),
    statusCam: document.getElementById("cam-perm"),
    vrLoadBtn: document.getElementById("vrLoadPuzzleBtn"),
    rememberBox: document.getElementById("rememberBox"),
    rememberCheck: document.getElementById("rememberCheck"),
    mic: document.getElementById("micSphere"),
    micTx: document.getElementById("mictx"),
    popup: document.getElementById("popup-wrapper"),
    allowBtn: document.getElementById("popup-allow"),
    denyBtn: document.getElementById("popup-deny"),
    solutionRoot: document.getElementById("solutionRoot"),
    scrambleRoot: document.getElementById("scrambleRoot"),
    puzzleText: document.getElementById("puzzleText"),
    winBox: document.getElementById("puzzleWin"),
    restartButton: document.getElementById("restartButtonVR"),
    restartPlane: document.getElementById("restartPlane"),
    popupHead: document.getElementById("popup-head"),
    popupText: document.getElementById("popup-text"),
    statusAudioStart: document.getElementById('statusAudioStart'),
    statusDataStart: document.getElementById('statusDataStart'), 
    statusAudioGame: document.getElementById('statusAudioGame'), 
    statusDataGame: document.getElementById('statusDataGame'),
    statusAudioText: document.getElementById('statusAudioText'), 
    statusDataText: document.getElementById('statusDataText'), 
};


// Firebase Refs und Client-ID
const PUZZLE_REF = ref(db, "puzzle/state");
const CLIENT_ID = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('client-' + Math.random().toString(36).slice(2));


// =========================================================================
// II. ZUSTANDSMANAGEMENT
// =========================================================================

/**
 * Mutabler Zustand der Anwendung. Alle lokalen Variablen konsolidiert.
 */
let STATE = {
    // Puzzle Zustand
    boardState: Array(CONFIG.PUZZLE.TOTAL_PIECES).fill(null),
    unplacedPieces: [], // IDs der Teile, die noch unplatziert sind
    errors: 0,
    selectedPiece: null,

    // Zeitmessungen
    permissionTime: 0,
    overallTime: 0,
    endPermissionTime: 0,
    taskStartTime:0,
    permissionPopupStartTime: 0,
    sessionCounter: 0,

    // Berechtigungen
    audioPermission: { granted: false, remember: false },
    dataPermission: { granted: false, remember: false },
    rememberSelection: false, // Temporäre Speicherung für das aktuelle Popup

    // Synchronisation
    lastUpdateLocal: 0,
};


// =========================================================================
// III. LOGGING & SESSION MANAGEMENT
// =========================================================================

function newSessionId() {
    return "S_vr_Puzzle_" + STATE.sessionCounter++;
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
        timestamp: (Date.now() / 1000).toFixed(2),
        device: "VR",
        ...details
    });
    console.log("[LOG]", eventType, details);
}
function getRandomInt(max) {
  return Math.floor(Math.random() * max);
}

function logDur(event) {
    let TASK_TIME_REF = ref(db, 'sessions/' + 'VR_Puzzle_'+getRandomInt(1000) + '/taskStartTime');
    push(TASK_TIME_REF, {
        event: event,
        duration: ((Date.now()-STATE.taskStartTime)/1000).toFixed(2),
        device: "Laptop"
    });
    console.log("[LOG]", STATE.taskStartTime);
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
 * Aktualisiert die Farbe und Sichtbarkeit der Status-Indikatoren (Ampel-Logik).
 */
function updatePermissionIndicators() {
    
    const audioGranted = STATE.audioPermission.granted;
    const dataGranted = STATE.dataPermission.granted;

    const audioColor = audioGranted ? 'green' : 'red';
    const dataColor = dataGranted ? 'green' : 'red';
    
    // 1. Startbildschirm-Indikatoren (Groß)
    DOM.statusAudioStart.setAttribute('material', 'color', audioColor);
    DOM.statusDataStart.setAttribute('material', 'color', dataColor);
    
    // 2. In-Game-Indikatoren (Klein)
    DOM.statusAudioGame.setAttribute('material', 'color', audioColor);
    DOM.statusDataGame.setAttribute('material', 'color', dataColor);
    
    // Stellen Sie sicher, dass die In-Game Indikatoren sichtbar sind, wenn das Spiel startet
    if (DOM.statusAudioGame.getAttribute('visible') === 'false') {
        DOM.statusAudioGame.setAttribute('visible', 'true');
        DOM.statusDataGame.setAttribute('visible', 'true');
        DOM.statusAudioText.setAttribute('visible','true');
        DOM.statusDataText.setAttribute('visible','true');
    }
}

/**
 * Zeigt die Synchronisations-Benachrichtigung in VR an.
 */
function showSyncNoticeVR(msg="Fortschritt gespeichert") {
  const notice = document.getElementById("syncNoticeVR");
  if (!notice) return;

  const textEl = notice.querySelector("a-text");
  textEl.setAttribute("value", ` ${msg}`);
  notice.setAttribute("visible", "true");

  notice.removeAttribute("animation__pulse");
  notice.setAttribute("animation__pulse", {
    property: "scale",
    to: "1 1 1.1",
    dir: "alternate",
    dur: 300,
    loop:1,
    easing: "easeInOutQuad"
  });

  setTimeout(() => {
    notice.setAttribute("visible", "false");
  }, 1200);
}

/**
 * Aktiviert einen pulsierenden Hinweis für das Mikrofon in VR.
 */
function pulseMic(active) {
  const mic = DOM.mic;
  if (!mic) return;
  if (active) {
    mic.setAttribute("animation__pulse", {
      property: "scale",
      to: "0 0 0",
      dir: "alternate",
      dur: 800,
      loop: true,
      easing: "easeInOutSine"
    });
    DOM.micTx.setAttribute("animation__pulse", {
      property: "scale",
      to: "0 0 0",
      dir: "alternate",
      dur: 800,
      loop: true,
      easing: "easeInOutSine"
    });
    mic.setAttribute("color", "#f00");
  }
}

/**
 * Prüft, ob das Puzzle gelöst wurde und zeigt den Endstatus an.
 */
function checkSolved() {
    const solved = STATE.boardState.every((val,idx)=>val===idx);
    if(!solved) return;
    
    const endTime = Date.now();
    const permissonDuration = ((STATE.endPermissionTime - STATE.permissionTime) / 1000).toFixed(2);
    const puzzleDuration = ((endTime - STATE.overallTime) / 1000).toFixed(2);
    const totalDuration = ((endTime - STATE.permissionTime) / 1000).toFixed(2);
    logDur("solved");
    DOM.puzzleText.setAttribute("text",{value:`Geschafft! Du hast \n⏱ ${STATE.errors} Fehler gemacht!`, align:"center", color:"#fff", width:8, wrapCount:30});
    DOM.puzzleText.setAttribute("visible","true");
    DOM.gamezone.setAttribute("visible", "false");
    DOM.winBox.setAttribute("visible","true");
    DOM.restartButton.setAttribute("visible", "true");
    DOM.restartButton.classList.add("clickable"); 
    DOM.restartPlane.classList.add("clickable"); 
    DOM.winBox.setAttribute("animation__pulse",{property:"scale", dir:"alternate", dur:1000, easing:"easeInOutSine", loop:true, to:"1.1 1.1 1"});
    
    console.log(puzzleDuration, totalDuration, permissonDuration);    
    // Speichere den gelösten Zustand
    savePuzzleStateVR({ solved: true }); 
    
    logEvent("puzzle_solved", { 
        duration: puzzleDuration, 
        overallDuration: totalDuration, // Gesamtzeit im Log
        permissonDuration: permissonDuration, // Berechtigungszeit im Log
        errors: STATE.errors 
    });
}

/**
 * Setzt die VR-Elemente des Puzzles auf den aktuellen STATE zurück.
 * Dies wird nach dem Laden eines gespeicherten Zustands und beim initialen Start aufgerufen.
 */
function renderVRPuzzleState() {
    const { COLS: cols, ROWS: rows, TOTAL_PIECES: totalPieces } = CONFIG.PUZZLE;
    const pieceSize = 0.5;
    const slotSpacing = 0.6;
    const startX = -0.5;
    const startY = 0.5;
    
    // 1. UI-Container leeren
    DOM.solutionRoot.innerHTML = "";
    DOM.scrambleRoot.innerHTML = "";
    STATE.selectedPiece = null;
    
    // 2. Lösungsslots generieren und Zustand anwenden
    for (let i = 0; i < totalPieces; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const slot = document.createElement('a-plane');
        slot.id = `slot-${i}`;
        slot.classList.add('slot', 'clickable');
        slot.setAttribute('width', pieceSize);
        slot.setAttribute('height', pieceSize);
        slot.setAttribute('position', `${startX + c * slotSpacing} ${startY - r * slotSpacing} 0`);
        slot.dataset.index = i;

        const pieceIdx = STATE.boardState[i];
        if (pieceIdx !== null && pieceIdx !== undefined) {
            slot.setAttribute('material', `src:#puzzleTex; shader:flat; repeat:${1 / cols} ${1 / rows}; offset:${(pieceIdx % cols) / cols} ${1 - (Math.floor(pieceIdx / cols) + 1) / rows}`);
        } else {
            slot.setAttribute('material', 'color:#888; shader:flat');
        }

        slot.addEventListener('click', onSlotClick);
        DOM.solutionRoot.appendChild(slot);
    }
    
    // 3. Scramble-Pieces generieren (Basierend auf STATE.unplacedPieces)
    const scrambleCols = 3, scrambleRows = 3, spacing = 0.6;
    const scrambleOffsetX = -3, scrambleOffsetY = 0.5;

    const scrambleBg = document.createElement('a-plane');
    scrambleBg.setAttribute('width', spacing * scrambleCols + 0.2);
    scrambleBg.setAttribute('height', spacing * scrambleRows + 0.2);
    scrambleBg.setAttribute('position', `${scrambleOffsetX + (spacing * (scrambleCols - 1)) / 2} ${scrambleOffsetY - (spacing * (scrambleRows - 1)) / 2} -0.01`);
    scrambleBg.setAttribute('material', 'color:#aaa; opacity:0.3; shader:flat');
    DOM.scrambleRoot.appendChild(scrambleBg);

    // Wir rendern nur die Teile in STATE.unplacedPieces, basierend auf ihrer Position in dieser Liste.
    STATE.unplacedPieces.forEach((pieceIdx, index) => {
        const piece = document.createElement('a-plane');
        piece.classList.add('scramble-piece', 'clickable');
        piece.setAttribute('width', pieceSize);
        piece.setAttribute('height', pieceSize);
        piece.setAttribute('material', `src:#puzzleTex; shader:flat; repeat:${1 / cols} ${1 / rows}; offset:${(pieceIdx % cols) / cols} ${1 - (Math.floor(pieceIdx / cols) + 1) / rows}`);
        const r = Math.floor(index / scrambleCols);
        const c = index % scrambleCols;
        piece.setAttribute('position', `${scrambleOffsetX + c * spacing} ${scrambleOffsetY - r * spacing} 0.05`);
        piece.dataset.index = pieceIdx;
        
        piece.setAttribute('visible', 'true'); 

        piece.addEventListener('click', onPieceClick);
        DOM.scrambleRoot.appendChild(piece);
    });
}

/**
 * Handler für das Klicken auf ein Puzzleteil im scramble-Bereich.
 */
function onPieceClick(e) {
    e.stopPropagation();
    const piece = e.currentTarget;
    const pieceIdx = parseInt(piece.dataset.index, 10);
    if (piece.getAttribute('visible') === 'false') return;

    // Toggle Auswahl
    if (STATE.selectedPiece === piece) {
        piece.classList.remove('selected-piece');
        STATE.selectedPiece = null;
        piece.setAttribute('material',`color:#fff; shader:flat` ,`src:#puzzleTex; shader:flat; repeat:${1 / CONFIG.PUZZLE.COLS} ${1 / CONFIG.PUZZLE.ROWS}; offset:${(pieceIdx % CONFIG.PUZZLE.COLS) / CONFIG.PUZZLE.COLS} ${1 - (Math.floor(pieceIdx / CONFIG.PUZZLE.COLS) + 1) / CONFIG.PUZZLE.ROWS}`);
    } else if (!STATE.selectedPiece && !piece.classList.contains('selected-piece')) {
        piece.classList.add('selected-piece');
        piece.setAttribute('material', `color:#ff0; shader:flat`);
        STATE.selectedPiece = piece;
    }
}

/**
 * Handler für das Klicken auf einen Slot im Lösungsbereich.
 */
function onSlotClick(e) {
    e.stopPropagation();
    const slot = e.currentTarget;
    
    if (!STATE.selectedPiece) return;

    const pieceIndex = parseInt(STATE.selectedPiece.dataset.index, 10);
    const slotIndex = parseInt(slot.dataset.index, 10);
    if (Number.isNaN(pieceIndex) || Number.isNaN(slotIndex)) return;

    if (pieceIndex === slotIndex && STATE.boardState[slotIndex] === null) {
        // Richtige Position
        logDur("selected"+pieceIndex);
        STATE.boardState[slotIndex] = pieceIndex;
        
        // Entferne das Teil aus der Liste der unplatzierten Teile
        const indexToRemove = STATE.unplacedPieces.indexOf(pieceIndex);
        if (indexToRemove > -1) {
            STATE.unplacedPieces.splice(indexToRemove, 1);
        }

        STATE.selectedPiece.setAttribute('visible', 'false');
        STATE.selectedPiece.classList.remove('selected-piece');
        STATE.selectedPiece = null;

        slot.setAttribute('material', `src:#puzzleTex; shader:flat; repeat:${1 / CONFIG.PUZZLE.COLS} ${1 / CONFIG.PUZZLE.ROWS}; offset:${(slotIndex % CONFIG.PUZZLE.COLS) / CONFIG.PUZZLE.COLS} ${1 - (Math.floor(slotIndex / CONFIG.PUZZLE.COLS) + 1) / CONFIG.PUZZLE.ROWS}`);
        slot.setAttribute('animation__highlight', { property: 'material.color', from: '#0f0', to: '#fff', dur: 500, easing: 'easeInOutQuad' });

        savePuzzleStateVR();
        checkSolved();
    } else {
        // Falsche Position
        STATE.errors++;
        savePuzzleStateVR();
        logEvent("error", {
          type: "wrong_answer",
          error_nbr: STATE.errors,
          pieceIndex: pieceIndex,
          slotIndex: slotIndex
        });
        slot.removeAttribute('animation__wrong');
        slot.setAttribute('animation__wrong', { property: 'material.color', from: '#888', to: '#f00', dur: 150, dir: 'alternate', loop: 1 });
    }
}


// =========================================================================
// V. PUZZLE STATE SYNCHRONISIERUNG (NUR MANUELL/SPEICHERN)
// =========================================================================

/**
 * Wandelt ein potenzielles Firebase-Objekt oder Array in ein valides
 * boardState Array der korrekten Größe (totalPieces) um.
 */
function coerceBoardState(remoteData, totalPieces) {
    // 1. Array der korrekten Größe (9) mit null-Werten initialisieren.
    let newBoardState = Array(totalPieces).fill(null); 

    if (!remoteData || typeof remoteData !== 'object') {
        return newBoardState;
    }
    
    // 2. Iteriere über die Schlüssel (Indizes) des abgerufenen Datensatzes
    const sourceData = remoteData; 

    for (const key in sourceData) {
        const index = parseInt(key);
        
        // Prüfe auf gültigen Index und ob der Wert nicht null ist.
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
 * Speichert den aktuellen Puzzle-Zustand in Firebase.
 */
async function savePuzzleStateVR(additionalPayload = {}) {

    // Prüft, ob die Datenspeicherung erlaubt ist.
    if (!STATE.dataPermission.granted) {
        console.warn('[VR SYNC] Save skipped: Data permission not granted.');
        showSyncNoticeVR("Speichern fehlgeschlagen: Datenspeicherung nicht erlaubt.");
        return;
    }
    const payload = { 
      boardState: STATE.boardState, 
      unplacedPieces: STATE.unplacedPieces,
        duration: STATE.overallTime,
      errors: STATE.errors,
      solved: STATE.boardState.every((val, idx) => val === idx),
      timestamp: Date.now(), 
      source: CLIENT_ID,
      ...additionalPayload
    };
    try {
        await set(PUZZLE_REF, payload);
        STATE.lastUpdateLocal = payload.timestamp;
        showSyncNoticeVR();
        logEvent("puzzle_state_saved", { 
            placedCount: STATE.boardState.filter(v => v !== null).length, 
            isCompleted: payload.solved,
            timestamp: payload.timestamp,
            duration: STATE.overallTime
        });
    } catch (err) {
        console.warn('[VR SYNC] save failed', err);
    }
}

/**
 * Wendet einen externen (remote) Zustand an, falls dieser neuer ist.
 * Wird NUR durch den Start- oder den "Fortschritt laden"-Button ausgelöst.
 */
function applyRemoteStateIfNewerVR(remote) {
    if (!remote?.timestamp) return;
    if (remote.source === CLIENT_ID) return;
    if (remote.timestamp <= (STATE.lastUpdateLocal || 0)) return;

    // Gesamtzeit vom Remote-Status übernehmen
    if (remote.puzzleStartTime) {
        STATE.overallTime = remote.puzzleStartTime;
    }

    const totalPieces = CONFIG.PUZZLE.TOTAL_PIECES;
    
    // 1. Board State und unplacedPieces aktualisieren
    STATE.boardState = coerceBoardState(remote.boardState, totalPieces);
    STATE.errors = remote.errors;

    if (Array.isArray(remote.unplacedPieces)) {
        STATE.unplacedPieces = remote.unplacedPieces.slice();
    } else {
        const placedPieceIds = new Set(STATE.boardState.filter(id => id !== null));
        STATE.unplacedPieces = [...Array(totalPieces).keys()].filter(id => !placedPieceIds.has(id));
        console.warn("Remote state missing valid unplacedPieces array. Deriving it...");
    }

    // 2. UI neu generieren und aktualisieren
    renderVRPuzzleState(); 

    // 3. Gelöst prüfen
    if (remote.solved) {
        checkSolved();
    }

    STATE.lastUpdateLocal = remote.timestamp;
    console.log("✅ VR Puzzle-State aus Remote geladen und angewendet.");
}

// ❌ FIREBASE LISTENER ENTFERNT: 
// Das Echtzeit-onValue(PUZZLE_REF, ...) wird entfernt, um die automatische Synchronisation zu verhindern.

// =========================================================================
// VI. PERMISSIONS & POPUPS
// =========================================================================

function initPermissionListeners() {
  // ACHTUNG: Die Permission-Listener bleiben aktiv, da die Permissions
  // vom Laptop oder durch den Reset-Button im VR-Headset geändert werden können.
  // Das ist UNABHÄNGIG vom Puzzle-State.
  const audioRef = ref(db, "permission/audio");
  const dataRef = ref(db, "permission/data");

  const handlePermissionChange = (type, val) => {
    if (!val) return;

    const perm = (type === "audio") ? STATE.audioPermission : STATE.dataPermission;
    perm.granted = val.granted;
    perm.remember = val.remember;

    updatePermissionIndicators();
    DOM.statusCam.removeAttribute('animation__pulse');
    DOM.statusCam.setAttribute('color', val?.granted ? '#0f0' : '#f00');
    DOM.statusCam.setAttribute('animation__pulse', {
        property: 'scale',
        to: '1.3 1.3 1',
        dir: 'alternate',
        dur: 300,
        loop: 1,
        easing: 'easeInOutQuad'
    });
  };
  
  onValue(audioRef, snap => handlePermissionChange("audio", snap.val()));
  onValue(dataRef,  snap => handlePermissionChange("data", snap.val()));
}

async function updatePermissionsInFirebase(type, granted, remember=false) {
  const refPath = `permission/${type}`;
  await set(ref(db, refPath), {
    permType: type,
    granted: granted,
    remember: remember,
    timestamp: new Date().toISOString(),
    source: "vr"
  });
}

function showPopup(type,title, message, onAllow, onDeny) {

    STATE.permissionPopupStartTime = Date.now();
    
    logEvent("popup_shown", {
        title: title,
        permissionType: type
    });
    DOM.popup.setAttribute("visible", "true");
    DOM.popupText.setAttribute("value", message);
    DOM.popupHead.setAttribute("value", title);
    DOM.permissionBtn.classList.remove("clickable");

    DOM.allowBtn.onclick = async () => {
        DOM.popup.setAttribute("visible", "false"); 
        
        logEvent("permission_answer", {
            permissionType: type,
            granted: true,
            remember: STATE.rememberSelection,
            responseTime: ((Date.now() - STATE.permissionPopupStartTime) / 1000).toFixed(2)
        });

        if (onAllow) await onAllow();
    };

    DOM.denyBtn.onclick = async () => {
        DOM.popup.setAttribute("visible", "false");

        logEvent("permission_answer", {
            permissionType: type,
            granted: false,
            remember: STATE.rememberSelection,
            responseTime: ((Date.now() - STATE.permissionPopupStartTime) / 1000).toFixed(2)
        });

        if (onDeny) await onDeny();
    };
}

async function askPermission(type) {
  const { title, message } = CONFIG.POPUP_TEXTS[type];

  // 1. Logik-Variable zurücksetzen (muss für jedes Popup neu gesetzt werden)
    STATE.rememberSelection = false; 
    
    // 2. Visuelles Element zurücksetzen (Häkchen unsichtbar machen)
    if (DOM.rememberCheck) {
        DOM.rememberCheck.setAttribute('visible', 'false'); 
    }

  return new Promise((resolve) => {
    showPopup(
      type,
      title,
      message,
      async () => {
        await updatePermissionsInFirebase(type, true, STATE.rememberSelection);
        resolve(true);
      },
      async () => {
        await updatePermissionsInFirebase(type, false, STATE.rememberSelection);
        resolve(false);
      }
    );
  });
}


// =========================================================================
// VII. SPIELKONTROLLE (START/RESTART/RESET)
// =========================================================================

/**
 * Setzt das gesamte Puzzle zurück (UI, Permissions, Firebase-State).
 * Wird durch Klick auf den Status-Punkt ausgelöst.
 */
async function resetPuzzle() {
    // 1. Permissions zurücksetzen
    await updatePermissionsInFirebase('audio', false, false);
    await updatePermissionsInFirebase('data', false, false);

    // 2. Puzzle-State in Firebase zurücksetzen (set auf null)
    const totalPieces = CONFIG.PUZZLE.TOTAL_PIECES;
    await set(PUZZLE_REF, null); 
    
    // 3. Lokalen State zurücksetzen
    STATE.boardState.fill(null);
    STATE.unplacedPieces = [...Array(totalPieces).keys()];
    STATE.lastUpdateLocal = Date.now(); 
    
    
    // 4. Status-Anzeigen zurücksetzen
    DOM.puzzleText.setAttribute("visible", "false");
    DOM.winBox.setAttribute("visible", "false");
    DOM.restartButton.setAttribute("visible", "false");
    DOM.micTx.setAttribute("visible","false");
    DOM.mic.setAttribute("visible","false");
    
    console.log('[VR SYNC] Puzzle-State und Permissions zurückgesetzt');
}

/**
 * Startet das VR-Spiel und lädt ggf. den Zustand (einmaliger `get`).
 */
async function startGame() {

  STATE.endPermissionTime = Date.now();

  DOM.permissionBtn.setAttribute("visible", "false");
  DOM.plane.classList.remove("clickable"); 
  DOM.allowBtn.classList.remove("clickable");
  DOM.denyBtn.classList.remove("clickable");
  DOM.startEntity.setAttribute("visible", "false");
  DOM.vrLoadBtn.setAttribute("visible", true);
    DOM.gamezone.setAttribute("visible", "true");
  
  // Zustand prüfen / laden / initialisieren (EINMALIGER GET-AUFRUF!)
  const snap = await get(PUZZLE_REF);
  let stateInitialized = false;

  if (snap.exists() && STATE.dataPermission.granted) {
      applyRemoteStateIfNewerVR(snap.val()); // Lädt boardState und unplacedPieces
      stateInitialized = true;
        let remote=snap.val();
      // Gesamtzeit vom Remote-Status übernehmen
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

    const totalPieces = CONFIG.PUZZLE.TOTAL_PIECES;
      const order = [...Array(totalPieces).keys()].sort(() => Math.random() - 0.5);
      STATE.boardState.fill(null);
      STATE.unplacedPieces = order;
      DOM.statusAudioGame.setAttribute('visible', 'true');
      DOM.statusDataGame.setAttribute('visible', 'true');
        DOM.statusAudioText.setAttribute('visible', 'true');
      DOM.statusDataText.setAttribute('visible', 'true');
      updatePermissionIndicators();
      renderVRPuzzleState(); // Render mit neu initialisiertem Zustand
      if(STATE.dataPermission.granted) {
          // Gesamtstartzeit mitspeichern
          await savePuzzleStateVR({ puzzleStartTime: STATE.overallTime }); 
      }
  } else {
        DOM.statusAudioGame.setAttribute('visible', 'true');
        DOM.statusDataGame.setAttribute('visible', 'true');
      DOM.statusAudioText.setAttribute('visible', 'true');
        DOM.statusDataText.setAttribute('visible', 'true');
        updatePermissionIndicators();
        renderVRPuzzleState(); 
  }

  if(STATE.audioPermission.granted){
    DOM.micTx.setAttribute("visible","true")
    DOM.mic.setAttribute("visible","true")
  }
}

/**
 * Startet das Spiel neu nach dem Lösen (zurück zum Startbildschirm).
 */
async function restartVRPuzzle() {

  // 1. UI zurücksetzen/wechseln
  DOM.winBox.setAttribute("visible", "false");
  DOM.puzzleText.setAttribute("visible", "false");
  DOM.micTx.setAttribute("visible","false")
  DOM.mic.setAttribute("visible","false")
  DOM.vrLoadBtn.setAttribute("visible", false);
    DOM.restartButton.classList.remove("clickable"); 
    DOM.restartPlane.classList.remove("clickable"); 
  
  DOM.solutionRoot.innerHTML = "";
  DOM.scrambleRoot.innerHTML = "";
  DOM.startEntity.setAttribute("visible", "true");
  DOM.permissionBtn.setAttribute("visible", "true");
  DOM.plane.classList.add("clickable"); 
  DOM.allowBtn.classList.add("clickable"); 
  DOM.denyBtn.classList.add("clickable"); 
  DOM.statusAudioGame.setAttribute('visible', 'false');
    DOM.statusDataGame.setAttribute('visible', 'false');
    DOM.statusAudioText.setAttribute('visible','true');
    DOM.statusDataText.setAttribute('visible','true');
  
  // 2. Study Session beenden
  await endStudySession();

  // 3. Permissions zurücksetzen, wenn "Merken" nicht aktiv war
  if(!STATE.audioPermission.remember){
      STATE.audioPermission.granted = false; 
      updatePermissionIndicators();
      await updatePermissionsInFirebase('audio', false, false);
  }
  if(!STATE.dataPermission.remember){
      STATE.dataPermission.granted = false; 
      updatePermissionIndicators();
      await updatePermissionsInFirebase('data', false, false);
  }

  // 4. Puzzle-State in Firebase löschen (set auf null)
  await set(PUZZLE_REF, null);
  
  // 5. Lokale Variablen zurücksetzen
  STATE.boardState.fill(null);
  STATE.unplacedPieces = [...Array(CONFIG.PUZZLE.TOTAL_PIECES).keys()];
  STATE.selectedPiece = null;
  STATE.errors = 0;

  console.log("🔄 Puzzle vollständig zurückgesetzt – bereit für Neustart!");
}


// =========================================================================
// VIII. EVENT LISTENER
// =========================================================================

// Start-Button Handler: Verwaltet den Permission-Flow und startet das Spiel.
DOM.plane.addEventListener('click', async (e) => {
    // Prüfen, ob die Start-Entität sichtbar ist (um Clicks während des Spiels zu vermeiden)
    if (DOM.startEntity.getAttribute('visible') === 'false') return; 
    
    STATE.permissionTime = Date.now();
    STATE.taskStartTime=Date.now();
    
    await startStudySession();

    logEvent("task_started", {
        permissionState: {
            audio: STATE.audioPermission,
            data: STATE.dataPermission
        }
    });

    const shouldAskAudio = !STATE.audioPermission.granted || !STATE.audioPermission.remember;
    const shouldAskData = !STATE.dataPermission.granted || !STATE.dataPermission.remember;

    if (shouldAskAudio &&  !STATE.audioPermission.remember) {
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

// Reset-Button (Status Cam) Handler: Setzt alles zurück.
DOM.statusCam.addEventListener('click', resetPuzzle);

// Load Button Handler (MANUELLE SYNCHRONISATION)
DOM.vrLoadBtn.addEventListener("click", async () => {

    // Prüft, ob die Datenspeicherung erlaubt ist, bevor geladen wird.
    if (!STATE.dataPermission.granted) {
        showSyncNoticeVR("Laden fehlgeschlagen: Datenspeicherung nicht erlaubt.");
        return;
    }
    // Verwendet GET (einmaliges Abrufen) statt onValue (Echtzeit-Listener)
    const snap = await get(PUZZLE_REF); 
    if (snap.exists() && STATE.dataPermission.granted) {
        applyRemoteStateIfNewerVR(snap.val());
        console.log("✅ VR Puzzle-Fortschritt manuell geladen.");
        logEvent("manual_puzzle_load_vr", snap.val());
    } else {
        showSyncNoticeVR("Kein Fortschritt zum Laden gefunden.");
    }
});

// Restart Button Handler
DOM.restartButton.addEventListener("click", async (e) => {
    e.stopPropagation();
    await restartVRPuzzle();
});


// Remember Checkbox Handler
if (DOM.rememberBox) {
  DOM.rememberBox.addEventListener("click", (e) => {
    e.stopPropagation(); // Verhindert, dass der Klick das Popup schließt
    STATE.rememberSelection = !STATE.rememberSelection;
    if (DOM.rememberCheck) DOM.rememberCheck.setAttribute("visible", STATE.rememberSelection);
  });
}

// =========================================================================
// IX. INITIALISIERUNG
// =========================================================================
initPermissionListeners();

// FIX: Sicherstellen, dass das Start-Plane initial klickbar ist.
DOM.plane.classList.add("clickable");
