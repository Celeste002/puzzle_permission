import { db } from './firebase.js';
import { ref, onValue, set, get } from './lib/firebase-database.js';

// -------------------- DOM Elemente --------------------
const permissionBtn = document.getElementById('permissionBtn');
const plane = document.getElementById('plane');
const startEntity = document.getElementById('startEntity');
const status_cam = document.getElementById("cam-perm");

const rememberBox = document.getElementById("rememberBox");
const rememberCheck = document.getElementById("rememberCheck");
const mic = document.getElementById("micSphere");
const micTx = document.getElementById("mictx");

const popup = document.getElementById("popup-wrapper");
const allowBtn = document.getElementById("popup-allow");
const denyBtn = document.getElementById("popup-deny");

// -------------------- Variablen --------------------
let remember = false;
let puzzleTime = null;
let endPermissionTime = null
let overallTime = null;
let permissionTime = null;
let errors = 0;

// Lokale Statusvariablen (korrekt als Objekte)
let audioPermission = { granted: false, remember: false };
let dataPermission  = { granted: false, remember: false };

const cols = 3, rows = 3, totalPieces = cols * rows;
let boardState = Array(totalPieces).fill(null);
let selectedPiece = null;

const PUZZLE_REF = ref(db, "puzzle/state");
const CLIENT_ID = (crypto && crypto.randomUUID) ? crypto.randomUUID() : ('client-' + Math.random().toString(36).slice(2));
let lastUpdateLocal = 0;

// -------------------- Helper: Sync Notice --------------------
function showSyncNoticeVR(msg="Fortschritt gespeichert") {

  const notice = document.getElementById("syncNoticeVR");
  if (!notice) return;

  // Text aktualisieren und sichtbar machen
  const textEl = notice.querySelector("a-text");
  textEl.setAttribute("value", ` ${msg}`);
  notice.setAttribute("visible", "true");

  // Pulsierende Animation hinzufügen
  notice.removeAttribute("animation__pulse");
  notice.setAttribute("animation__pulse", {
    property: "scale",
    
    to: "1 1 1.5",
    dir: "alternate",
    dur: 300,
    loop:1,
    easing: "easeInOutQuad"
  });

  // Nach 1.2 Sekunden wieder ausblenden
  setTimeout(() => {
    notice.setAttribute("visible", "false");
  }, 1200);
}

// -------------------- Helper: Sync Notice --------------------
function pulseMic(active) {
  
  if (!mic) return;
  if (active) {
    mic.setAttribute("animation__pulse", {
      property: "scale",
      to: "1.2 1.2 1.2",
      dir: "alternate",
      dur: 600,
      loop: true,
      easing: "easeInOutSine"
    });
    mic.setAttribute("color", "#0f0");
  } else {
    mic.removeAttribute("animation__pulse");
    mic.setAttribute("color", "#f00");
  }
}

// -------------------- Firebase: Puzzle State --------------------
async function savePuzzleStateVR() {
    const payload = { 
      boardState, 
      timestamp: Date.now(), 
      source: CLIENT_ID };
    try {
        await set(PUZZLE_REF, payload);
        lastUpdateLocal = payload.timestamp;
        showSyncNoticeVR();
    } catch (err) {
        console.warn('[VR SYNC] save failed', err);
    }
}

function applyRemoteStateIfNewerVR(remote) {
    if (!remote?.timestamp) return;
    if (remote.source === CLIENT_ID) return;
    if (remote.timestamp <= (lastUpdateLocal || 0)) return;

    if (Array.isArray(remote.boardState) && remote.boardState.length === totalPieces) {
        boardState = remote.boardState.slice();

        for (let i = 0; i < totalPieces; i++) {
            const slot = document.getElementById(`slot-${i}`);
            const pieceIdx = boardState[i];
            if (slot) {
                if (pieceIdx === null) {
                    // leerer Slot → graue/placeholder Material
                    slot.setAttribute('material', `src:#puzzleTex; shader:flat; repeat:${1/cols} ${1/rows}; offset:0 0; color:#888`);
                } else {
                    // Material anhand des tatsächlich eingesetzten pieceIdx setzen
                    slot.setAttribute('material', `src:#puzzleTex; shader:flat; repeat:${1/cols} ${1/rows}; offset:${(pieceIdx%cols)/cols} ${1-(Math.floor(pieceIdx/cols)+1)/rows}`);
                }
            }

            // verberge entsprechende scramble-piece falls vorhanden
            if (pieceIdx !== null && typeof pieceIdx !== 'undefined') {
              const sEl = document.querySelector(`.scramble-piece[data-index='${pieceIdx}']`);
              if (sEl) sEl.setAttribute('visible', 'false');
            }
        }

        checkSolved();
    }

    lastUpdateLocal = remote.timestamp;
}

// Firebase listener
onValue(PUZZLE_REF, (snapshot) => {
    const val = snapshot.val();
    if (!val) return;
    if(dataPermission.granted){
        applyRemoteStateIfNewerVR(val);
    }
});

// -------------------- Permissions --------------------
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

    status_cam.removeAttribute('animation__pulse');
    status_cam.setAttribute('color', val?.granted ? '#0f0' : '#f00');
    status_cam.setAttribute('animation__pulse', {
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
  console.log(`[PERM] ${type} → granted=${granted}, remember=${remember}`);
}

// -------------------- Reset via Status Cam --------------------
status_cam.addEventListener('click', async () => {
    await updatePermissionsInFirebase('audio',false,false)
    await updatePermissionsInFirebase('data',false,false)
    const empty = { boardState: Array(totalPieces).fill(null), timestamp: Date.now(), source: CLIENT_ID };
    await set(PUZZLE_REF, empty);
    boardState.fill(null);
    selectedPiece = null;
    console.log('[VR SYNC] Puzzle-State zurückgesetzt');
});

// -------------------- Popup --------------------
function showPopup(titel, message, onAllow, onDeny) {
    popup.setAttribute("visible", "true");
    document.getElementById("popup-text").setAttribute("value", message);
    document.getElementById("popup-head").setAttribute("value", titel);
    permissionBtn.classList.remove("clickable");

    allowBtn.onclick = async () => {
        popup.setAttribute("visible", "false");    
        if (onAllow) await onAllow();
    };

    denyBtn.onclick = async () => {
        popup.setAttribute("visible", "false");
        if (onDeny) await onDeny();
    };
}
async function askAllPermissions() {
  await askPermission("audio");
  await askPermission("data");
}
async function askPermission(type) {
  const popupConfig = {
    audio: {
      title: "Mikrofonzugriff erlauben?",
      message:
        "Darf die App auf dein Mikrofon zugreifen, um mögliche Sprachbefehle zu verarbeiten?",
    },
    data: {
      title: "Datenspeicherung erlauben?",
      message:
        "Diese Anwendung kann deinen Puzzle-Fortschritt speichern, damit du später weiterspielen kannst.\n" +
        "Die Daten werden nicht an Dritte weitergegeben und können jederzeit über den Reset-Button gelöscht werden.\n\n" +
        "Möchtest du die Speicherung deines Fortschritts erlauben?",
    },
  };

  const { title, message } = popupConfig[type];

  return new Promise((resolve) => {
    showPopup(
      title,
      message,
      async () => {
        await updatePermissionsInFirebase(type, true, remember);
        resolve(true);
      },
      async () => {
        await updatePermissionsInFirebase(type, false, remember);
        resolve(false);
      }
    );
  });
}
function allPermissionsDenied() {
  return !audioPermission.granted && !dataPermission.granted;
}
function allRememberDenied() {
  return !audioPermission.remember && !dataPermission.remember;
}

// -------------------- Start Button --------------------
plane.addEventListener('click', async (e) => {
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
    startPuzzle();
});

// -------------------- Puzzle Logik --------------------
async function startPuzzle() {

  puzzleTime = Date.now();
  endPermissionTime = Date.now();
  overallTime = Date.now();

  permissionBtn.setAttribute("visible", "false");
  plane.classList.remove("clickable");
  allowBtn.classList.remove("clickable");
  denyBtn.classList.remove("clickable");
  startEntity.setAttribute("visible", "false");
  micTx.setAttribute("visible","true")
  mic.setAttribute("visible","true")
  setTimeout(() => micTx.setAttribute("visible","false"), 2000);

  const solutionRoot = document.getElementById("solutionRoot");
  const scrambleRoot = document.getElementById("scrambleRoot");
  solutionRoot.innerHTML = "";
  scrambleRoot.innerHTML = "";
  selectedPiece = null;

  // Prüfen, ob Puzzle-State vorhanden
  const snapshot = await get(PUZZLE_REF);
  const puzzleData = snapshot.val();
  boardState = (puzzleData && Array.isArray(puzzleData.boardState))
    ? puzzleData.boardState.slice()
    : Array(totalPieces).fill(null);

  // Falls noch kein State existiert → initial speichern
  if (!puzzleData) await savePuzzleStateVR();

  // Layout-Parameter
  const pieceSize = 0.5;
  const slotSpacing = 0.6;
  const startX = -0.5;
  const startY = 0.5;

  // Lösungsslots generieren
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

    const pieceIdx = boardState[i];
    if (pieceIdx !== null && pieceIdx !== undefined) {
      slot.setAttribute('material', `src:#puzzleTex; shader:flat; repeat:${1 / cols} ${1 / rows}; offset:${(pieceIdx % cols) / cols} ${1 - (Math.floor(pieceIdx / cols) + 1) / rows}`);
    } else {
      slot.setAttribute('material', 'color:#888; shader:flat');
    }

    slot.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedPiece) return;

      const pieceIndex = parseInt(selectedPiece.dataset.index, 10);
      const slotIndex = parseInt(slot.dataset.index, 10);
      if (Number.isNaN(pieceIndex) || Number.isNaN(slotIndex)) return;

      // 💡 wichtig: kein "if (pieceIndex)" mehr, sonst 0 = false!
      if (pieceIndex === slotIndex && boardState[slotIndex] === null) {
        boardState[slotIndex] = pieceIndex;
        selectedPiece.setAttribute('visible', 'false');
        selectedPiece.classList.remove('selected-piece');
        selectedPiece = null;

        slot.setAttribute('material', `src:#puzzleTex; shader:flat; repeat:${1 / cols} ${1 / rows}; offset:${(slotIndex % cols) / cols} ${1 - (Math.floor(slotIndex / cols) + 1) / rows}`);
        slot.setAttribute('animation__highlight', { property: 'material.color', from: '#0f0', to: '#fff', dur: 500, easing: 'easeInOutQuad' });

        if(dataPermission.granted){
            savePuzzleStateVR();
        }
        checkSolved();
      } else {
        errors++;
        slot.removeAttribute('animation__wrong');
        slot.setAttribute('animation__wrong', { property: 'material.color', from: '#888', to: '#f00', dur: 150, dir: 'alternate', loop: 1 });
      }
    });

    solutionRoot.appendChild(slot);
  }

  // Scramble-Pieces generieren (zufällig!)
  const scrambleOrder = [...Array(totalPieces).keys()]
    .filter(i => !boardState.includes(i))
    .sort(() => Math.random() - 0.5);

  const scrambleCols = 3, scrambleRows = 3, spacing = 0.6;
  const scrambleOffsetX = -3, scrambleOffsetY = 0.5;

  const scrambleBg = document.createElement('a-plane');
  scrambleBg.setAttribute('width', spacing * scrambleCols + 0.2);
  scrambleBg.setAttribute('height', spacing * scrambleRows + 0.2);
  scrambleBg.setAttribute('position', `${scrambleOffsetX + (spacing * (scrambleCols - 1)) / 2} ${scrambleOffsetY - (spacing * (scrambleRows - 1)) / 2} -0.01`);
  scrambleBg.setAttribute('material', 'color:#aaa; opacity:0.3; shader:flat');
  scrambleRoot.appendChild(scrambleBg);

  scrambleOrder.forEach((pieceIdx, index) => {
    const piece = document.createElement('a-plane');
    piece.classList.add('scramble-piece', 'clickable');
    piece.setAttribute('width', pieceSize);
    piece.setAttribute('height', pieceSize);
    piece.setAttribute('material', `src:#puzzleTex; shader:flat; repeat:${1 / cols} ${1 / rows}; offset:${(pieceIdx % cols) / cols} ${1 - (Math.floor(pieceIdx / cols) + 1) / rows}`);
    const r = Math.floor(index / scrambleCols);
    const c = index % scrambleCols;
    piece.setAttribute('position', `${scrambleOffsetX + c * spacing} ${scrambleOffsetY - r * spacing} 0.05`);
    piece.dataset.index = pieceIdx;

    piece.addEventListener('click', (e) => {
      e.stopPropagation();
      if (piece.getAttribute('visible') === 'false') return;

      // Toggle Auswahl
      if (selectedPiece === piece) {
        piece.classList.remove('selected-piece');
        selectedPiece = null;
        piece.setAttribute('material', `src:#puzzleTex; shader:flat; repeat:${1 / cols} ${1 / rows}; offset:${(pieceIdx % cols) / cols} ${1 - (Math.floor(pieceIdx / cols) + 1) / rows}`);
      } else if (!selectedPiece) {
        piece.classList.add('selected-piece');
        piece.setAttribute('material', `color:#ff0; shader:flat`);
        selectedPiece = piece;
      }
    });

    scrambleRoot.appendChild(piece);
  });
}

// -------------------- Check Solved --------------------
function checkSolved() {
    const solved = boardState.every((val,idx)=>val===idx);
    if(solved){
        const endTime = Date.now();
        const permissonDuration=((endPermissionTime-permissionTime)/1000).toFixed(2);
        const overallDuration=((endTime-overallTime)/1000).toFixed(2);
        const puzzleDuration=((endTime-puzzleTime)/1000).toFixed(2);
        const restartButton = document.getElementById("restartButtonVR");

        const puzzleText=document.getElementById("puzzleText");
        const winBox=document.getElementById("puzzleWin");
        puzzleText.setAttribute("text",{value:`Geschafft! Du hast \n⏱ ${puzzleDuration} Sekunden gebraucht!`, align:"center", color:"#fff", width:8, wrapCount:30});
        puzzleText.setAttribute("visible","true");
        winBox.setAttribute("visible","true");
        restartButton.setAttribute("visible", "true");
        winBox.setAttribute("animation__pulse",{property:"scale", dir:"alternate", dur:1000, easing:"easeInOutSine", loop:true, to:"1.1 1.1 1"});
        
        // -------------------- Restart Button Setup --------------------        if (restartButton) {
          restartButton.addEventListener("click", async (e) => {
            e.stopPropagation();
            console.log("🔁 Restart button clicked!");
            await restartVRPuzzle();
          });
        }
    
} 

async function restartVRPuzzle() {
  console.log("🔁 Neustart des VR-Puzzles gestartet...");

  // UI zurücksetzen
  const winBox = document.getElementById("puzzleWin");
  const puzzleText = document.getElementById("puzzleText");
  winBox.setAttribute("visible", "false");
  micTx.setAttribute("visible","false")
  mic.setAttribute("visible","false")
  puzzleText.setAttribute("visible", "false");

  // Puzzle-State löschen (Firebase)
  const empty = {
    boardState: Array(totalPieces).fill(null),
    timestamp: Date.now(),
    source: CLIENT_ID
  };
  await set(PUZZLE_REF, empty);

  // Lokale Variablen zurücksetzen
  boardState.fill(null);
  selectedPiece = null;
  errors = 0;

  // Szene zurücksetzen: Puzzleteile + Buttons wieder aktivieren
  document.getElementById("solutionRoot").innerHTML = "";
  document.getElementById("scrambleRoot").innerHTML = "";
  startEntity.setAttribute("visible", "true");
  permissionBtn.setAttribute("visible", "true");
  plane.classList.add("clickable");
  allowBtn.classList.add("clickable");
  denyBtn.classList.add("clickable");
  
  if(!audioPermission.remember){
      audioPermission.granted==false
      await updatePermissionsInFirebase('audio', false, false);
  }
  if(!dataPermission.remember){
      dataPermission.granted==false
      await updatePermissionsInFirebase('data', false, false);
  }

  console.log("🔄 Puzzle vollständig zurückgesetzt – bereit für Neustart!");
}

// rememberBox behandeln
if (rememberBox) {
  rememberBox.addEventListener("click", () => {
    remember = !remember;
    if (rememberCheck) rememberCheck.setAttribute("visible", remember);
  });
}

initPermissionListeners();