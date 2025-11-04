import { db } from './firebase.js';
import { ref, onValue, set, get } from './lib/firebase-database.js';

// -------------------- DOM Elemente --------------------
const permissionBtn = document.getElementById("permissionBtn");
const game = document.getElementById("game");
const piecesContainer = document.getElementById("pieces");
const boardContainer = document.getElementById("board");
const ss = document.getElementById("startScreen");

const popupOverlay = document.getElementById("popupOverlay");
const popupBox = document.getElementById("popupBox");
const allowBtn = document.getElementById("allowBtn");
const denyBtn = document.getElementById("denyBtn");
const rememberChk = document.getElementById("rememberChk");
const motionDot = document.getElementById("motionDot");
const mic = document.getElementById("micReminder");
const micText = document.getElementById("micText");

// -------------------- Puzzle Settings --------------------
const puzzleImage = "./shield.png";
const cols = 3;
const rows = 3;
const totalPieces = cols * rows;
let boardState = Array(totalPieces).fill(null);
let errors = 0;
let selectedPiece = null;

let permissionTime = null;
let overallTime = null;
let puzzleTime = null;
let endPermissionTime = null;

// Lokale Statusvariablen (korrekt als Objekte)
let audioPermission = { granted: false, remember: false };
let dataPermission  = { granted: false, remember: false };

// Firebase Refs
const puzzleRef = ref(db, "puzzle/state");
const CLIENT_ID = crypto.randomUUID ? crypto.randomUUID() : ('client-' + Math.random().toString(36).slice(2));
let lastUpdateLocal = 0;

// -------------------- Mikrofon-Erinnerung --------------------
function pulseMic(active) {

    if (!mic) return;
    if (active) {
        mic.style.backgroundColor = "#f00";
        mic.style.boxShadow = "0 0 10px rgba(255,0,0,0.5)";
    
        setInterval(() => 
            {
                if(mic.style.opacity==1){
                    mic.style.opacity=0
                }else{
                    mic.style.opacity=1;
                }

            }, 1200);
        
    } 
}
// -------------------- Helper: Sync Notice --------------------
function showSyncNotice(msg = "Fortschritt gespeichert") {
    let el = document.getElementById('syncNotice');
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 1200);
}

// -------------------- Permissions --------------------
// aktualisiert LED nur, wenn beide aktiv sind
function updatePermissionDotCombined() {

  const bothGranted = audioPermission.granted && dataPermission.granted;
  const one= audioPermission.granted || dataPermission.granted;
  const dot = document.getElementById("motionDot");
  if (!dot) return;
  const allowed = dot.classList.contains("allowed");
  const mixed = dot.classList.contains("mixed");

  if (bothGranted && !allowed) {
    dot.classList.remove("mixed");
    dot.classList.add("allowed", "pulse");
    setTimeout(() => dot.classList.remove("pulse"), 500);
  } else if (!bothGranted && allowed) {
    dot.classList.remove("allowed");
  } else if(one && !bothGranted){
    dot.classList.add("mixed")
  } else if(!one && mixed){
    dot.classList.remove("mixed");
  } else{
    dot.classList.remove("mixed")
    dot.classList.remove("allowed")
  }
  return bothGranted;
}

// schreibt Permission in Firebase (schreibt nur, ändert keine lokalen Flags)
async function updatePermissionsInFirebase(type, granted, remember = false) {
  
    const refPath = `permission/${type}`;
  await set(ref(db, refPath), {
    permType: type,
    granted: granted,
    remember: remember,
    timestamp: new Date().toISOString(),
    source: "laptop"
  });
  console.log(`[PERM] ${type} → granted=${granted}, remember=${remember}`);
}

// init permission listeners: nur lesen, keine Rückschreibungen (vermeidet Race)
function initPermissionListeners() {
  const audioRef = ref(db, "permission/audio");
  const dataRef = ref(db, "permission/data");

  // Handler: übernimmt die Struktur {granted, remember} sauber in lokale Objekte
  const handlePermissionChange = (type, val) => {
    if (!val) return;

    if (type === "audio") {
      audioPermission.granted = val.granted;
      audioPermission.remember = val.remember;
    } else {
      dataPermission.granted = val.granted;
      dataPermission.remember = val.remember;
    }
    // Update combined UI indicator
    updatePermissionDotCombined();
  };

  onValue(audioRef, snap => handlePermissionChange("audio", snap.val()));
  onValue(dataRef,  snap => handlePermissionChange("data", snap.val()));
}

function allPermissionsDenied() {
  return !audioPermission.granted && !dataPermission.granted;
}
function allRememberDenied() {
  return !audioPermission.remember && !dataPermission.remember;
}

// -------------------- Puzzle State Sync --------------------
async function savePuzzleState() {
    const payload = {
        boardState: boardState,
        timestamp: Date.now(),
        source: CLIENT_ID
    };
    try {
        await set(puzzleRef, payload);
        lastUpdateLocal = payload.timestamp;
        console.log('[SYNC] saved', payload);
        showSyncNotice();
    } catch (err) {
        console.warn('[SYNC] save failed', err);
    }
}

function applyRemoteStateIfNewer(remote) {
    if (!remote || !remote.timestamp) return;
    if (remote.source === CLIENT_ID) return;
    if (remote.timestamp <= (lastUpdateLocal || 0)) return;

    if (Array.isArray(remote.boardState) && remote.boardState.length === totalPieces) {
        boardState = remote.boardState.slice();
        for (let i = 0; i < totalPieces; i++) {
            const slot = document.querySelector(`.slot[data-index='${i}']`);
            const pieceIdx = boardState[i];

            if (slot) {
                if (pieceIdx === null) {
                    slot.style.backgroundImage = '';
                    slot.classList.remove('filled-slot');
                } else {
                    slot.style.backgroundImage = `url(${puzzleImage})`;
                    slot.style.backgroundSize = `${cols * 100}px ${rows * 100}px`;
                    slot.style.backgroundPosition = `${-(pieceIdx % cols) * 100}px ${-Math.floor(pieceIdx / cols) * 100}px`;
                    slot.classList.add('filled-slot');
                }
            }

            const pieceEl = document.querySelector(`.piece[data-piece='${pieceIdx}']`);
            if (pieceEl) {
                pieceEl.style.display = pieceIdx === null ? '' : 'none';
                pieceEl.draggable = (pieceIdx === null);
                if (pieceIdx === null) pieceEl.classList.remove('selected-piece');
            }
        }
        checkSolved();
    }
    lastUpdateLocal = remote.timestamp;
}

onValue(puzzleRef, (snapshot) => {
    const val = snapshot.val();
    if (!val) return;
    if(dataPermission.granted){
        applyRemoteStateIfNewer(val);
    }
    
});

// -------------------- Popup --------------------
function showPopup(title, message, onAllow, onDeny) {
    popupOverlay.style.display = "block";
    popupBox.style.display = "block";
    const head = document.getElementById("popupHead");
    const text = document.getElementById("popupText");
    if (head) head.textContent = title;
    if (text) text.textContent = message;

    allowBtn.onclick = async () => {
        popupOverlay.style.display = "none";
        popupBox.style.display = "none";
        if (onAllow) await onAllow();
    };

    denyBtn.onclick = async () => {
        popupOverlay.style.display = "none";
        popupBox.style.display = "none";
        if (onDeny) await onDeny();
    };
}

// askAllPermissions: benutzt die aktuelle Checkbox-Werte (rememberChk.checked) beim Schreiben
async function askAllPermissions() {

    await askPermission("audio");
    await askPermission("data");

}
async function askPermission(type) {
    // Texte für die verschiedenen Berechtigungstypen
    const popupConfig = {
        audio: {
            title: "Mikrofonnutzung zulassen?",
            message:
                "Darf diese Anwendung auf dein Puzzle-Audio bzw. Soundeffekte zugreifen, um das Spielerlebnis zu verbessern?",
        },
        data: {
            title: "Datenspeicherung zulassen?",
            message:
                "Diese Anwendung kann deinen Puzzle-Fortschritt lokal auf deinem Gerät speichern, damit du später weiterspielen kannst. " +
                "Die Daten werden nicht an Dritte weitergegeben und können jederzeit über den Reset-Button gelöscht werden.\n\n" +
                "Möchtest du die lokale Speicherung deines Fortschritts erlauben?",
        },
    };

    const { title, message } = popupConfig[type];

    return new Promise((resolve) => {
        showPopup(
            title,
            message,
            async () => {
                const rememberValue = rememberChk.checked;
                await updatePermissionsInFirebase(type, true, rememberValue);
                resolve(true);
                
                
            },
            async () => {
                const rememberValue = rememberChk.checked;
                await updatePermissionsInFirebase(type, false, rememberValue);
                resolve(false);
                
            }
        );
    });
}
// -------------------- Puzzle Logic --------------------
function handleDrop(e) {
    e.preventDefault();
    const slotIndex = parseInt(e.currentTarget.dataset.index);
    if (!selectedPiece) return;

    const pieceIndex = parseInt(selectedPiece.dataset.piece);
    if (boardState[slotIndex] !== null) return;

    if (pieceIndex === slotIndex) {
        boardState[slotIndex] = pieceIndex;
        e.currentTarget.appendChild(selectedPiece);
        selectedPiece.draggable = false;
        selectedPiece.classList.remove("selected-piece");
        selectedPiece = null;
        checkSolved();
        if(dataPermission.granted){
            savePuzzleState();
        }
        
    } else {
        errors++;
        e.currentTarget.classList.add("wrong");
        setTimeout(() => e.currentTarget.classList.remove("wrong"), 300);
        piecesContainer.appendChild(selectedPiece);
        selectedPiece.classList.remove("selected-piece");
        selectedPiece = null;
    }
}

async function initPuzzle() {
    endPermissionTime = Date.now();
    puzzleTime = Date.now();
    errors = 0;
    selectedPiece = null;

    micText.style.opacity = "1";
    mic.style.opacity = "1";
    setTimeout(() => micText.style.opacity="0", 2000);

    boardContainer.innerHTML = "";
    piecesContainer.innerHTML = "";

    // Slots erstellen
    for (let i = 0; i < totalPieces; i++) {
        const slot = document.createElement("div");
        slot.className = "slot";
        slot.dataset.index = i;
        slot.addEventListener("dragover", (e) => e.preventDefault());
        slot.addEventListener("drop", handleDrop);
        boardContainer.appendChild(slot);
    }

    // Hole aktuellen Firebase-State (falls vorhanden) bevor Teile gebildet werden
    try {
        const snap = await get(puzzleRef);
        const val = snap.val();
        if (val && Array.isArray(val.boardState) && val.boardState.length === totalPieces) {
            applyRemoteStateIfNewer(val);
        } else {
            boardState = Array(totalPieces).fill(null);
        }
    } catch (err) {
        console.warn('[INIT] could not read firebase state', err);
    }

    // Puzzleteile erzeugen (nur für freie Indices sichtbar)
    const order = [...Array(totalPieces).keys()].sort(() => Math.random() - 0.5);
    order.forEach((i) => {
        if (boardState.includes(i)) {
            const piece = document.createElement("div");
            piece.className = "piece hidden";
            piece.dataset.piece = i;
            piece.style.display = 'none';
            piecesContainer.appendChild(piece);
            return;
        }

        const piece = document.createElement("div");
        piece.className = "piece clickable";
        piece.draggable = true;
        piece.dataset.piece = i;
        piece.style.backgroundImage = `url(${puzzleImage})`;
        piece.style.backgroundSize = `${cols * 100}px ${rows * 100}px`;
        piece.style.backgroundPosition = `${-(i % cols) * 100}px ${-Math.floor(i / cols) * 100}px`;

        piece.addEventListener("dragstart", () => {
            selectedPiece = piece;
            piece.classList.add("selected-piece");
        });

        piecesContainer.appendChild(piece);
    });
}

// -------------------- Check Solved --------------------
function checkSolved() {
    const solved = boardState.every((val, idx) => val === idx);
    if (!solved) return;

    const endTime = Date.now();
    const permissonDuration = ((endPermissionTime - permissionTime) / 1000).toFixed(2);
    const overallDuration = ((endTime - overallTime) / 1000).toFixed(2);
    const puzzleDuration = ((endTime - puzzleTime) / 1000).toFixed(2);

    // Status anzeigen
    const statusEl = document.getElementById("status");
    const statusText = document.getElementById("statusText");
    const statusTime = document.getElementById("statusTime");
    const restartBtn = document.getElementById("restartBtn");

    statusEl.style.display = "block";
    statusText.textContent = "Puzzle gelöst! 🎉";
    statusTime.textContent = `Zeit: ${puzzleDuration} Sekunden`;

    restartBtn.addEventListener("click", restartGame);

    console.log("Puzzle solved in", puzzleDuration, "seconds");
    console.log("Everything solved in", overallDuration, "seconds");
    console.log("Permission solved in", permissonDuration, "seconds");
    console.log("Everything solved with", errors, "errors");

}

async function restartGame() {

    // UI zurücksetzen
    const statusEl = document.getElementById("status");
    const statusText = document.getElementById("statusText");
    const statusTime = document.getElementById("statusTime");

    statusEl.style.display = "none";
    game.style.display = "none";
    ss.style.display = "block";
    statusText.textContent = "";
    statusTime.textContent = "";
    micText.style.opacity = "0";
    mic.style.opacity = "0";

    permissionBtn.style.display = "inline-block";

    if(!audioPermission.remember){
        audioPermission.granted==false
        await updatePermissionsInFirebase('audio', false, false);
    }
    if(!dataPermission.remember){
        dataPermission.granted==false
        await updatePermissionsInFirebase('data', false, false);
    }

    // Puzzle-State löschen
    await set(puzzleRef, { boardState: Array(totalPieces).fill(null), timestamp: Date.now(), source: CLIENT_ID });

    console.log("Spiel neu gestartet. Zurück zur Startseite.");
}

// -------------------- Reset / MotionDot --------------------
async function resetPuzzle() {

    await updatePermissionsInFirebase('audio', false, false);
    await updatePermissionsInFirebase('data', false, false);
    console.log("Permissions zurückgesetzt!");

    const emptyPuzzleState = { boardState: Array(totalPieces).fill(null), timestamp: Date.now(), source: CLIENT_ID };
    await set(puzzleRef, emptyPuzzleState);
    boardState = Array(totalPieces).fill(null);
    lastUpdateLocal = emptyPuzzleState.timestamp;

    initPuzzle();
    console.log("Puzzle-State zurückgesetzt und neu gestartet!");
}

motionDot.addEventListener("click", resetPuzzle);

function startGame() {
    permissionBtn.style.display = "none";
    ss.style.display = "none";
    game.style.display = "block";
    initPuzzle();
}

// -------------------- Button Events --------------------
permissionBtn.addEventListener("click", async () => {
    permissionTime = Date.now();
    overallTime = Date.now();

    if (allPermissionsDenied() && allRememberDenied()) {
        await askAllPermissions();
    } else if(!audioPermission.granted && !audioPermission.remember){
        await askPermission("audio") 
    }
    else if(!dataPermission.granted && !dataPermission.remember){
        await askPermission("data")
        
    }  
      pulseMic(audioPermission.granted)
      startGame();
});

// remember checkbox: nur UI state, echte writes lesen aus Firebase listeners
rememberChk.addEventListener("change", () => {
    // optional: visual feedback if you want
    // console.log('remember checked =', rememberChk.checked);
});

// -------------------- Init --------------------
initPermissionListeners();
