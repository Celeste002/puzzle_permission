import { db } from './firebase.js';
import { ref, onValue, set, get } from './lib/firebase-database.js';

// -------------------- DOM Elemente --------------------
const startBtn = document.getElementById("startBtn");
const ss = document.getElementById("startScreen");

const popupOverlay = document.getElementById("popupOverlay");
const popupBox = document.getElementById("popupBox");
const allowBtn = document.getElementById("allowBtn");
const denyBtn = document.getElementById("denyBtn");
const rememberChk = document.getElementById("rememberChk");
const motionDot = document.getElementById("motionDot");
const gameBox = document.getElementById("gameBox");
const mic = document.getElementById("micReminder");
const micText = document.getElementById("micText");
let ans1 = document.getElementById("ans1")
let ans2 = document.getElementById("ans2")
const stateRef = ref(db, "math/state");
let question=document.getElementById("question")
let answers=document.getElementById("answers")

let permissionTime = null;
let overallTime = null;
let puzzleTime = null;
let endPermissionTime = null;

const permissions = {
  audio: ref(db, "permission_math/audio"),
  data: ref(db, "permission_math/data")
};
let currentQuestion = 0;
let userAnswers = [];
let score=0;

// Lokale Statusvariablen (korrekt als Objekte)
let audioPermission = { granted: false, remember: false };
let dataPermission  = { granted: false, remember: false };

// Firebase Refs

const CLIENT_ID = crypto.randomUUID ? crypto.randomUUID() : ('client-' + Math.random().toString(36).slice(2));

const questions = [
  { q: "Was ist 3 + 4?", answers: ["6", "7"], correct: 1 },
  { q: "Was ist 5 x 2?", answers: ["10", "12"], correct: 0 },
  { q: "Was ist 9 - 3?", answers: ["5", "6"], correct: 1 },
  { q: "Was ist 15 / 3?", answers: ["5", "3"], correct: 0 },
  { q: "Was ist 17 - 3?", answers: ["14", "19"], correct: 0 },
  { q: "Was ist 8 + 3?", answers: ["11", "12"], correct: 0 },
  { q: "Was ist 9 x 3?", answers: ["18", "27"], correct: 1 },
  { q: "Was ist 6 + 12?", answers: ["18", "16"], correct: 0 },
  { q: "Was ist 9 / 3?", answers: ["6", "3"], correct: 1 },
  { q: "Was ist 19 - 7?", answers: ["12", "13"], correct: 0 },
];
// -------------------- Mikrofon-Erinnerung --------------------
function pulseMic(active) {

    if (!mic) return;
    

    if (active) {
      
      micText.style.opacity=1
      setTimeout(() => 
              {
                  if(micText.style.opacity==1){
                      micText.style.opacity=0
                  }else{
                      micText.style.opacity=1;
                  }

              }, 2000);
          mic.style.backgroundColor = "rgba(255, 30, 0, 1)";
          mic.style.boxShadow = "0 0 15px rgba(255, 51, 0, 0.6)"; 

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
  
    const refPath = `permission_math/${type}`;
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
  const audioRef = ref(db, "permission_math/audio");
  const dataRef = ref(db, "permission_math/data");

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

async function initPuzzle() {

    endPermissionTime = Date.now();
    puzzleTime = Date.now();
    pulseMic(audioPermission.granted)
    
    startBtn.style.display = "none";
    ss.style.display="none";
    gameBox.style.display = "block";
    question.style.display = "block";
    answers.style.display = "block";
    

    // gespeicherten Fortschritt laden
      const snapshot = await get(stateRef);
      const data = snapshot.val();
      if (data && data.answers) {
        userAnswers = data.answers;
        currentQuestion = data.currentQuestion || 0;
        score = data.score || 0;
        console.log("Gespeicherter Quizstatus geladen:", data);
      }
      loadQuestion();
}


function loadQuestion() {

let questionText=document.getElementById("questionText")

  if (currentQuestion >= questions.length) {
    checkSolved();
    
    return;
  }
  const q = questions[currentQuestion];
  questionText.textContent=q.q
  ans1.textContent=q.answers[0]
  ans2.textContent=q.answers[1]

}

function handleAnswer(ans,index) {
  
  const task = questions[currentQuestion];
  const correct = index === task.correct;

  if (correct) {
    score++;
    statusText.textContent = "Richtig!";
  } else {
    statusText.textContent = "Falsch!";
    if(ans=="1"){
      ans1.classList.add("wrong")
      setTimeout(()=>ans1.classList.remove("wrong"),300)
    }
    else if(ans=="2"){
      ans2.classList.add("wrong")
      setTimeout(()=>ans2.classList.remove("wrong"),500)
    }

  }
  
  currentQuestion++;
  if (dataPermission.granted) {
    showSyncNotice()
    set(stateRef, { currentQuestion, score });
  }
  setTimeout(()=>loadQuestion(),200)
}

ans1.addEventListener("click", () => handleAnswer("1",0));
ans2.addEventListener("click", () => handleAnswer("2",1));
// -------------------- Check Solved --------------------
function checkSolved() {

    const endTime = Date.now();
    const permissonDuration = ((endPermissionTime - permissionTime) / 1000).toFixed(2);
    const overallDuration = ((endTime - overallTime) / 1000).toFixed(2);
    const puzzleDuration = ((endTime - puzzleTime) / 1000).toFixed(2);

    // Status anzeigen
    const statusEl = document.getElementById("status");
    const statusText = document.getElementById("statusText");
    const statusTime = document.getElementById("statusTime");
    const restartBtn = document.getElementById("restartBtn");

    question.style.display = "none";
    answers.style.display = "none";
    gameBox.style.display = "none";
    mic.style.display="none";

    statusEl.style.display = "block";
    statusText.textContent = "Quiz geschafft!";
    statusTime.textContent = `Score: ${score} Punkte`;

    restartBtn.addEventListener("click", restartGame);

    console.log("Puzzle solved in", puzzleDuration, "seconds");
    console.log("Everything solved in", overallDuration, "seconds");
    console.log("Permission solved in", permissonDuration, "seconds");
    console.log("Everything solved with", score, "points");

}

async function restartGame() {

    // UI zurücksetzen
    const statusEl = document.getElementById("status");
    const statusText = document.getElementById("statusText");
    const statusTime = document.getElementById("statusTime");

    statusEl.style.display = "none";
    statusText.textContent = "";
    statusTime.textContent = "";

    micText.style.opacity = "0";
    mic.style.opacity = "0";

    question.style.display = "none";
    answers.style.display = "none";
    gameBox.style.display = "none";

    ss.style.display="block";
    startBtn.style.display = "inline-block";

    if(!audioPermission.remember){
        audioPermission.granted==false
        await updatePermissionsInFirebase('audio', false, false);
    }
    if(!dataPermission.remember){
        dataPermission.granted==false
        await updatePermissionsInFirebase('data', false, false);
    }
    
    await set(stateRef, { currentQuestion: 0, score: 0 });
   currentQuestion = 0;
   score = 0;
    console.log("Spiel neu gestartet. Zurück zur Startseite.");
}

// -------------------- Reset / MotionDot --------------------
async function resetPuzzle() {

    await updatePermissionsInFirebase('audio', false, false);
    await updatePermissionsInFirebase('data', false, false);
    console.log("Permissions zurückgesetzt!");
    motionDot.style.backgroundColor = "rgba(247, 179, 162, 1)";
    setTimeout(() => motionDot.style.backgroundColor =  "rgba(255, 30, 0, 1)", 100);
    console.log("Puzzle-State zurückgesetzt und neu gestartet!");
}

motionDot.addEventListener("click", resetPuzzle);


// -------------------- Button Events --------------------
startBtn.addEventListener("click", async () => {
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
      
      initPuzzle();
});

// remember checkbox: nur UI state, echte writes lesen aus Firebase listeners
rememberChk.addEventListener("change", () => {
    // optional: visual feedback if you want
    // console.log('remember checked =', rememberChk.checked);
});

// -------------------- Init --------------------
initPermissionListeners();
