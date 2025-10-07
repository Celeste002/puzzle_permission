import { db } from './firebase.js';
import { ref, onValue, set } from './lib/firebase-database.js';

const status = document.getElementById("status");
const permissionBtn = document.getElementById('permissionBtn');
const plane = document.getElementById('plane');
const startEntity = document.getElementById('startEntity');

const rememberBox = document.getElementById("rememberBox");
const resetBtn = document.getElementById("resetBtn");
let remember = false;

const permRef = ref(db, "permissions/puzzle_access");
let hasUserResponded = false;

let permissionGranted = null;
let rememberPermission = false;

let puzzleTime=null, endPermissionTime=null, overallTime=null, permissionTime=null;
const cols=3, rows=3, totalPieces=cols*rows;
let boardState=Array(totalPieces).fill(null);
let selectedPiece=null;
let errors=0;


resetBtn.addEventListener("click", async () => {

  await set(ref(db, "permissions/puzzle_access"), {
    granted: false,
    remember: false,
    permType: 'puzzle_access',
    source: 'vr'
  });
  console.log("Permissions zurückgesetzt!");
});

// ------------------- Popup Funktionen -------------------
const popup = document.getElementById("popup-wrapper");
const allowBtn = document.getElementById("popup-allow");
const denyBtn = document.getElementById("popup-deny");

function showPopup(message) {
  console.log("go!")
  popup.setAttribute("visible", "true");
  document.getElementById("popup-text").setAttribute("value", message);

  rememberBox.addEventListener("click", () => {
    remember = !remember;
    rememberBox.setAttribute("color", remember ? "#2ecc71" : "#444");
  });

  allowBtn.onclick = async () => {
    popup.setAttribute("visible", "false");
    hasUserResponded = true;
    await updatePermissionsInFirebase(true, remember);
    startPuzzle();
    
  };
  denyBtn.onclick = async () => {
    popup.setAttribute("visible", "false");
    hasUserResponded = true;
    await updatePermissionsInFirebase(false, remember);
    alert("Zugriff verweigert! Ohne Permission kein Puzzle.");
    
  };
}

// ------------------- Firebase -------------------
onValue(permRef, async (snapshot)=>{

  const val = snapshot.val();
  if(!val) return;

  // Nur reagieren, wenn Nutzer noch nicht geantwortet hat
  if (hasUserResponded) return;

  if(val.remember===false){

    await set(permRef,{granted:false, remember:false, permType:'puzzle_access', source:'vr'});
    permissionGranted=false;
    rememberPermission=false;
    console.log("VR Permissions zurückgesetzt, da remember=false");
    
  } else {

    permissionGranted = val.granted;
    rememberPermission = val.remember;

  }
});

async function updatePermissionsInFirebase(granted, remember=false){

  await set(permRef,{
    permType:'puzzle_access',
    granted: granted,
    remember: remember,
    timestamp: new Date().toISOString(),
    source:'vr'
  });
  permissionGranted = granted;
  rememberPermission = remember;
  console.log("VR Permissions gesetzt:", granted, remember);
}
// ------------------- Start Button Events -------------------
plane.addEventListener('click', async (e) => {
    e.stopPropagation();
    console.log("Permission Start Button clicked → Berechtigungs-Popup öffnen");
    
    permissionTime=Date.now();
    if(!permissionGranted) showPopup("Darf die App auf deine Daten zugreifen?");
    else startPuzzle();
  });


// ------------------- Puzzle Logik -------------------
function startPuzzle(){

  puzzleTime = Date.now();
  endPermissionTime = Date.now();
  overallTime = Date.now();

  permissionBtn.setAttribute("visible","false");
  permissionBtn.classList.remove("clickable");
  resetBtn.setAttribute("visible","false");
  resetBtn.classList.remove("clickable");
  plane.classList.remove("clickable");
  startEntity.setAttribute("visible","false");

  const solutionRoot = document.getElementById("solutionRoot");
  const scrambleRoot = document.getElementById("scrambleRoot");

  solutionRoot.innerHTML = "";
  scrambleRoot.innerHTML = "";
  boardState.fill(null);
  selectedPiece=null;

  const pieceSize=0.5;
  const slotSpacing=0.6;
  const startX=-0.5;
  const startY=0.5;

  // Lösungsslots
  for(let i=0;i<totalPieces;i++){

    const r=Math.floor(i/cols);
    const c=i%cols;
    const slot=document.createElement('a-plane');
    slot.setAttribute('id',`slot-${i}`);
    slot.setAttribute('class','slot clickable');
    slot.setAttribute('width',pieceSize);
    slot.setAttribute('height',pieceSize);
    slot.setAttribute('position',`${startX+c*slotSpacing} ${startY-r*slotSpacing} 0`);
    slot.setAttribute('material',`src:#puzzleTex; shader:flat; repeat:${1/cols} ${1/rows}; offset:${(i%cols)/cols} ${1-(Math.floor(i/cols)+1)/rows}; color:#888`);
    slot.dataset.index=i;

    slot.addEventListener('click', e=>{
      e.stopPropagation();
      if(!selectedPiece) return;
      const pieceIndex=parseInt(selectedPiece.dataset.index);
      const slotIndex=parseInt(slot.dataset.index);
      if(pieceIndex===slotIndex && boardState[slotIndex]===null){
        boardState[slotIndex]=pieceIndex;
        selectedPiece.setAttribute('visible','false');
        selectedPiece.classList.remove('selected-piece');
        selectedPiece=null;

        slot.setAttribute('material',`src:#puzzleTex; shader:flat; repeat:${1/cols} ${1/rows}; offset:${(slotIndex%cols)/cols} ${1-(Math.floor(slotIndex/cols)+1)/rows}`);
        slot.setAttribute('animation__highlight',{property:'material.color', from:'#0f0', to:'#fff', dur:500, easing:'easeInOutQuad'});
        checkSolved();
      } else {
        errors++;
        slot.removeAttribute('animation__wrong');
        slot.setAttribute('animation__wrong',{property:'material.color', from:'#888', to:'#f00', dur:150, dir:'alternate', loop:1});
      }
    });
    solutionRoot.appendChild(slot);
  }

  // Scramble Pieces
  const scrambleCols=3;
  const scrambleRows=3;
  const spacing=0.6;
  const scrambleOffsetX=-3;
  const scrambleOffsetY=0.5;

  const scrambleBg=document.createElement('a-plane');
  scrambleBg.setAttribute('width', spacing*scrambleCols+0.2);
  scrambleBg.setAttribute('height', spacing*scrambleRows+0.2);
  scrambleBg.setAttribute('position',`${scrambleOffsetX + (spacing*(scrambleCols-1))/2} ${scrambleOffsetY-(spacing*(scrambleRows-1))/2} -0.01`);
  scrambleBg.setAttribute('material','color:#aaa; opacity:0.3; shader:flat');
  scrambleRoot.appendChild(scrambleBg);

  const order=[...Array(totalPieces).keys()].sort(()=>Math.random()-0.5);
  order.forEach((i,index)=>{
    const piece=document.createElement('a-plane');
    piece.setAttribute('class','scramble-piece clickable');
    piece.setAttribute('width',pieceSize);
    piece.setAttribute('height',pieceSize);
    piece.setAttribute('material',`src:#puzzleTex; shader:flat; repeat:${1/cols} ${1/rows}; offset:${(i%cols)/cols} ${1-(Math.floor(i/cols)+1)/rows}`);
    const r=Math.floor(index/scrambleCols);
    const c=index%scrambleCols;
    piece.setAttribute('position',`${scrambleOffsetX+c*spacing} ${scrambleOffsetY-r*spacing} 0.05`);
    piece.dataset.index=i;

    piece.addEventListener('click', e=>{
      e.stopPropagation();
      if(piece.getAttribute('visible')==='false') return;
      if(selectedPiece && selectedPiece!==piece) return;

      if(selectedPiece===piece){
        piece.removeAttribute('material');
        piece.setAttribute('material',`src:#puzzleTex; shader:flat; repeat:${1/cols} ${1/rows}; offset:${(i%cols)/cols} ${1-(Math.floor(i/cols)+1)/rows}`);
        piece.classList.remove('selected-piece');
        selectedPiece=null;
      } else {
        piece.setAttribute('material','color:#ff0; shader:flat');
        piece.classList.add('selected-piece');
        selectedPiece=piece;
      }
    });
    scrambleRoot.appendChild(piece);
  });
}

function checkSolved(){

  const solved = boardState.every((val,idx)=>val===idx);
  if(solved){

    const endTime = Date.now();
    const permissonDuration=((endPermissionTime-permissionTime)/1000).toFixed(2);
    const overallDuration=((endTime-overallTime)/1000).toFixed(2);
    const puzzleDuration=((endTime-puzzleTime)/1000).toFixed(2);

    status.style.display="block";

    const puzzleText=document.getElementById("puzzleText");
    const winBox=document.getElementById("puzzleWin");
    puzzleText.setAttribute("text",{value:`Geschafft! Du hast \n⏱ ${puzzleDuration} Sekunden gebraucht!`, align:"center", color:"#fff", width:12, wrapCount:20});
    puzzleText.setAttribute("visible","true");
    winBox.setAttribute("visible","true");
    winBox.setAttribute("animation__pulse",{property:"scale", dir:"alternate", dur:1000, easing:"easeInOutSine", loop:true, to:"1.1 1.1 1"});

    console.log("Puzzle solved in", puzzleDuration,"seconds");
    console.log("Everything solved in", overallDuration,"seconds");
    console.log("Permission solved in", permissonDuration,"seconds");
    console.log("Everything solved with", errors,"Fehlern!");
  }
}

