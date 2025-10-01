// Import firebase
import { db, app } from './firebase.js';
import { ref, onValue, set } from './lib/firebase-database.js';

const permissionBtn = document.getElementById("permissionBtn");
const game = document.getElementById("game");
const piecesContainer = document.getElementById("pieces");
const boardContainer = document.getElementById("board");
const status = document.getElementById("status");
const ss= document.getElementById("startScreen");



const puzzleImage = "./shield.png"; // eigenes Bild ins Projekt legen
const cols = 3;
const rows = 3;
const totalPieces = cols * rows; // 9 Teile

let boardState = Array(totalPieces).fill(null);

let permissionTime = null;
let overallTime = null;
let puzzleTime = null;
let endPermissionTime=null;

let audioPermission=null;
let videoPermission=null;



async function checkPermissions() {
    

  try {
    // Mikrofon prüfen
    
    const micStatus = await navigator.permissions.query({ name: "microphone" });
    console.log("Mic:", micStatus.state); // "granted", "denied", "prompt"

    // Kamera prüfen
    const camStatus = await navigator.permissions.query({ name: "camera" });
    console.log("Camera:", camStatus.state);

    console.log("Permissions gecheckt ✅", micStatus.state, camStatus.state);
    return {
      audio: micStatus.state,
      video: camStatus.state
    };
  } catch (err) {

    console.warn("Permissions API nicht verfügbar:", err);
    return null;
  }
}

async function updatePermissionsInFirebase() {

    const status = await checkPermissions();
    if (!status) return;

    set(ref(db, "permissions/audio"), status.audio);
    set(ref(db, "permissions/video"), status.video);
    console.log("Permissions erteilt ✅", status.audio, status.video);
}

// Einmal beim Laden aufrufen
updatePermissionsInFirebase();

// Events abonnieren → reagiert live auf Änderungen
navigator.permissions.query({ name: "microphone" })
  .then(p => p.onchange = updatePermissionsInFirebase);

navigator.permissions.query({ name: "camera" })
  .then(p => p.onchange = updatePermissionsInFirebase);


onValue(ref(db,"permissions/audio"),(snapshot) => {

  audioPermission=snapshot.val();

})
onValue(ref(db,"permissions/video"), (snapshot) => {

  videoPermission=snapshot.val();

})

permissionBtn.addEventListener("click", async () =>{
    
    const status = await checkPermissions();

    permissionTime = Date.now();
    overallTime = Date.now();
    console.log(audioPermission,videoPermission,"FIREBASE");

    // Prüfen ob beide schon granted sind
    if ((status.audio=="granted" && status.video=="granted")||(audioPermission=="granted"&&videoPermission=="granted")) {

      permissionBtn.style.display = "none";
      ss.style.display="none"
      game.style.display = "block";
      
      initPuzzle();
      console.log("gotime!");

      return;

    }
    // Falls nicht: Erneut anfragen
    try {

        await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        // Speichere in Firebase
        await updatePermissionsInFirebase();
        console.log("Permission bestätigt und gespeichert!");

        permissionBtn.style.display = "none";
        ss.style.display="none"
        game.style.display = "block";
        
        initPuzzle();

    } catch (err) {

        alert("Zugriff verweigert! Ohne Permission kein Puzzle.");
        

    }
})

function initPuzzle() {

    console.log("lets go")
    // Timer starten
    endPermissionTime = Date.now();
    puzzleTime = Date.now();
    //startTime = Date.now();

    // Board Slots erstellen
    boardContainer.innerHTML = "";
    for (let i = 0; i < totalPieces; i++) {
        const slot = document.createElement("div");
        slot.className = "slot";
        slot.dataset.index = i;
        slot.addEventListener("dragover", (e) => e.preventDefault());
        slot.addEventListener("drop", onDrop);
        boardContainer.appendChild(slot);
    }
    
    // Puzzle Pieces erstellen (zufällig gemischt)
    const order = [...Array(totalPieces).keys()].sort(() => Math.random() - 0.5);
    piecesContainer.innerHTML = "";
    order.forEach((i) => {
        const piece = document.createElement("div");
        piece.className = "piece";
        piece.draggable = true;
        piece.dataset.piece = i;
        piece.style.backgroundImage = `url(${puzzleImage})`;
        piece.style.backgroundSize = `${cols * 100}px ${rows * 100}px`;;
        piece.style.backgroundPosition = `${-(i % cols) * 100}px ${-Math.floor(i / cols) * 100}px`;

        piece.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("piece", i);
        });

        piecesContainer.appendChild(piece);
        
    });
}

function onDrop(e) {
    const slotIndex = e.currentTarget.dataset.index;
    const pieceIndex = e.dataTransfer.getData("piece");

    if (boardState[slotIndex] === null) {
        boardState[slotIndex] = parseInt(pieceIndex);

        const piece = document.querySelector(`.piece[data-piece='${pieceIndex}']`);
        e.currentTarget.appendChild(piece);

        checkSolved();
    }
}

function checkSolved() {

    const solved = boardState.every((val, idx) => val === idx);

    if (solved) {

        const endTime = Date.now();
        const permissonDuration = ((endPermissionTime - permissionTime) / 1000).toFixed(2);
        const overallDuration = ((endTime - overallTime) / 1000).toFixed(2);
        const puzzleDuration = ((endTime - puzzleTime) / 1000).toFixed(2);
        
        status.style.display = "block";
        status.textContent = `Puzzle gelöst! Zeit: ${puzzleDuration} Sekunden`;

        console.log("Puzzle solved in", puzzleDuration, "seconds");
        console.log("Everything solved in", overallDuration, "seconds");
        console.log("Permission solved in", permissonDuration, "seconds");
    }
}