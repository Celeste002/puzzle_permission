import { db } from './firebase.js';
import { ref, onValue, set, get, push } from './lib/firebase-database.js';

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
const micStatus = document.getElementById("micStatus");
let ans1 = document.getElementById("ans1")
let ans2 = document.getElementById("ans2")

let question=document.getElementById("question")
let answers=document.getElementById("answers")

let taskStartTime = null;
let overallTime = null;
let puzzleTime = null;
let endPermissionTime = null;
let permissionPopupStartTime = null;
let counter=0;

const permissions = {
  audio: ref(db, "permission_math/audio"),
  data: ref(db, "permission_math/data")
};
const TASK_TIME_REF = ref(db, 'sessions/' + newSessionId() + '/taskStartTime');

// -------------------- Spielzustand --------------------
let currentQuestion = 0;
let userAnswers = [];
const stateRef = ref(db, "math/state");
let score=0;

// Lokale Statusvariablen (korrekt als Objekte)
let audioPermission = { granted: false, remember: false };
let dataPermission  = { granted: false, remember: false };
// -------------------- Fragenkatalog --------------------
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
// -------------------- Session ID --------------------
// ---- SESSION ID HANDLING ----
function newSessionId() {
    return "S_Lap_Math_" + counter++;
}

function getSessionId() {
  return localStorage.getItem("sessionId");
}
function getLogRef() {
  return ref(db, "study_logs/" + getSessionId());
}
// -------------------- Logging Helper --------------------
function logEvent(eventType, details = {}) {
    push(getLogRef(), {
        eventType,
        timestamp: Date.now(),
        device: "Laptop",
        ...details
    });
    console.log("[LOG]", eventType, details);
}
function logDur(event) {
      push(TASK_TIME_REF, {
          event: event,
          duration: ((Date.now()-taskStartTime)/1000).toFixed(2),
          device: "Laptop"
      });
      console.log("[LOG]", taskStartTime);

}

async function endStudySession() {
    console.log("Study session finished. Resetting session ID.");

    // log final event
    logEvent("session_complete");

    // aktuelle Session-ID löschen
    localStorage.removeItem("sessionId");
}
async function startStudySession() {
    console.log("Study session started. Creating new session ID.");

    // neue generieren
    const newId = newSessionId();

    localStorage.setItem("sessionId", newId);

    const newSessionRef = ref(db, "study_logs/" + newId);

    await set(newSessionRef, {
        sessionId: newId,
        createdAt: Date.now(),
        note: "New participant started"
    });

    console.log("New session ID:", newId);
}


//let randomQuestion = shuffle([...questions]);

// -------------------- Firebase Math State --------------------

// ✦ State aus Firebase laden (für VR/Laptop Sync)
async function loadExistingState() {
    const snapshot = await get(stateRef);
    const state = snapshot.val();

    if (!state) return;

    currentQuestion = state.currentQuestion ?? 0;
    score = state.score ?? 0;
}
// ------------------------------
//  🔄 LOAD PROGRESS BUTTON
// ------------------------------
const loadBtn = document.getElementById("loadProgressBtn");

async function loadProgressFromFirebase() {
    console.log("🔄 Lade aktuellen Mathe-Status...");

    await loadExistingState()
    loadQuestion();
    console.log("✅ Fortschritt geladen:", state);

    // Logging
    logEvent("manual_load", {
        questionIndex: currentQuestion,
        score
    });
}
function updatePermissionIndicators() {
    
    const audioGranted = audioPermission.granted;
    const dataGranted = dataPermission.granted;

    // Audio Dot: Fügt 'status-active' hinzu, wenn granted == true
    if (audioDot) {
        audioDot.classList.toggle('allowed', audioGranted);
    }
    if (audioDotGame) {
        audioDotGame.classList.toggle('allowed', audioGranted);
    }

    // Data Dot: Fügt 'status-active' hinzu, wenn granted == true
    if (dataDot) {
        dataDot.classList.toggle('allowed', dataGranted);
    }
    if (dataDotGame) {
        dataDotGame.classList.toggle('allowed', dataGranted);
    }
    
    
}
// -------------------- Mikrofon-Erinnerung --------------------
function pulseMic(active) {

   const micEl = micStatus;
    if (!micEl) return;
    
    if (active) {
        micEl.style.backgroundColor = "#f00";
        micEl.style.boxShadow = "0 0 10px rgba(255,0,0,0.5)";

        // Puls-Effekt 
        setInterval(() => {
            micEl.style.opacity = (micEl.style.opacity == 1) ? 0 : 1;
        
        }, 1000);
    }
}
// -------------------- Helper: Sync Notice --------------------
function showSyncNotice(msg = "Fortschritt gespeichert") {
    let el = document.getElementById('syncNotice');
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => el.style.display = 'none', 800);
}
// -------------------- Berechtigungsmanagement --------------------

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
    updatePermissionIndicators()
  };

  onValue(audioRef, snap => handlePermissionChange("audio", snap.val()));
  onValue(dataRef,  snap => handlePermissionChange("data", snap.val()));
}

// -------------------- Popup --------------------
function showPopup(type, title, message, onAllow, onDeny) {

    permissionPopupStartTime = Date.now();
    rememberChk.checked = false;  
    logEvent("popup_shown", {
        title: title,
        permissionType: type
    });

    popupOverlay.style.display = "block";
    popupBox.style.display = "block";
    const head = document.getElementById("popupHead");
    const text = document.getElementById("popupText");
    if (head) head.textContent = title;
    if (text) text.textContent = message;

    allowBtn.onclick = async () => {
        popupOverlay.style.display = "none";
        popupBox.style.display = "none";

        logEvent("permission_answer", {
        permissionType: type,
        granted: true,
        remember: rememberChk?.checked ?? false,
        responseTime: ((Date.now() - permissionPopupStartTime)/ 1000).toFixed(2)
      });

        if (onAllow) await onAllow();
    };

    denyBtn.onclick = async () => {

      logEvent("permission_answer", {
        permissionType: type,
        granted: false,
        remember: rememberChk?.checked ?? false,
        responseTime: ((Date.now() - permissionPopupStartTime)/ 1000).toFixed(2)
      });
      popupOverlay.style.display = "none";
      popupBox.style.display = "none";
      if (onDeny) await onDeny();
    };
}

async function askPermission(type) {
    // Texte für die verschiedenen Berechtigungstypen
    const popupConfig = {
        audio: {
            title: "Mikrofonzugriff erlauben?",
            message:
                "Diese Anwendung nutzt dein Mikrofon, um Audiofeedback zuzulassen. \n Die Aufnahmen werden nicht gespeichert oder an Dritte weitergegeben.\n Magst du den Zugriff erlauben?",
        },
        data: {
            title: "Datenspeicherung erlauben?",
            message:
                "Diese Anwendung kann deinen Quiz-Fortschritt speichern, damit du zu einem anderen Zeitpunkt weiterspielen kannst.\n" +
                "Die Daten werden nicht an Dritte weitergegeben und sind jederzeit mit den Reset-Button widerrufbar.\n\n" +
                "Magst du die Speicherung deines Fortschritts erlauben?",
        },
    };

    const { title, message } = popupConfig[type];

    return new Promise((resolve) => {
        
        showPopup(
          type,
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

    if(audioPermission.granted){
        micText.style.opacity = "1";
        micReminder.style.opacity = "1";
        
    }

    pulseMic(audioPermission.granted)
    
    
    startBtn.style.display = "none";
    ss.style.display="none";
    gameBox.style.display = "block";
    question.style.display = "block";
    answers.style.display = "block";
    
    
    loadQuestion();
}

function loadQuestion() {

let questionText=document.getElementById("questionText")
loadBtn.style.display = "inline-block";

let solvedTasksText=document.getElementById("solvedTasksText")
solvedTasksText.textContent=`Aufgabe: ${currentQuestion} / ${questions.length}`

  if (currentQuestion >= questions.length) {
    checkSolved();
    
    return;
  }
  const q = questions[currentQuestion];
  questionText.textContent=q.q
  ans1.textContent=q.answers[0]
  ans2.textContent=q.answers[1]

}

async function handleAnswer(ans,index) {
  
  const task = questions[currentQuestion];
  const correct = index === task.correct;
  logDur(currentQuestion);
  if (correct) {
    score++;
    statusText.textContent = "Richtig!";
  } else {

    logEvent("error", {
        type: "wrong_answer",
        question: currentQuestion,
        chosen: index,
        correctAnswer: task.correct
    });

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

  logEvent("task_completed", {
    question: currentQuestion,
    duration: ((Date.now() - taskStartTime)/ 1000).toFixed(2)
  });
  
  currentQuestion++;
  if(dataPermission.granted){
          showSyncNotice("Fortschritt gespeichert");
      }
      else{
            showSyncNotice("Speichern fehlgeschlagen: Datenspeicherung nicht erlaubt.");
      }
  if (dataPermission.granted) {
    await set(stateRef, {
        currentQuestion,
        score
    });
    
}
  setTimeout(()=>loadQuestion(),300)
}

ans1.addEventListener("click", () => handleAnswer("1",0));
ans2.addEventListener("click", () => handleAnswer("2",1));
// -------------------- Check Solved --------------------
async function checkSolved() {

    const endTime = Date.now();
    const permissonDuration = ((endPermissionTime - taskStartTime) / 1000).toFixed(2);
    const overallDuration = ((endTime - overallTime) / 1000).toFixed(2);
    const puzzleDuration = ((endTime - puzzleTime) / 1000).toFixed(2);

    // Status anzeigen
    const statusEl = document.getElementById("status");
    const statusText = document.getElementById("statusText");
    const statusTime = document.getElementById("statusTime");
    const restartBtn = document.getElementById("restartBtn");
    logDur("solved");
    question.style.display = "none";
    answers.style.display = "none";
    gameBox.style.display = "none";
    mic.style.opacity="0";
    micText.style.opacity="0";


    statusEl.style.display = "block";
    statusText.textContent = "Du hast alle Aufgaben erfolgreich gelöst! Du kannst das Quiz über den Neustart-Button erneut beginnen.";
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

    await endStudySession();
    

    statusEl.style.display = "none";
    statusText.textContent = "";
    statusTime.textContent = "";

    micText.style.opacity = "0";
    mic.style.opacity = "0";

    question.style.display = "none";
    answers.style.display = "none";
    gameBox.style.display = "none";
    loadBtn.style.display = "none";

    ss.style.display="block";
    startBtn.style.display = "inline-block";

    if(!audioPermission.remember){
        audioPermission.granted==false
        updatePermissionIndicators()
        await updatePermissionsInFirebase('audio', false, false);
    }
    if(!dataPermission.remember){
        dataPermission.granted==false
        updatePermissionIndicators()
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
    updatePermissionIndicators()
    console.log("Permissions zurückgesetzt!");
  
    console.log("Puzzle-State zurückgesetzt und neu gestartet!");
}

motionDot.addEventListener("click", resetPuzzle);
// Button aktivieren
loadBtn.addEventListener("click", loadProgressFromFirebase);
// -------------------- Button Events --------------------
startBtn.addEventListener("click", async () => {
    taskStartTime = Date.now();
    overallTime = Date.now();

    await startStudySession()

    // zuerst vorhandenen Stand aus Firebase laden
    await loadExistingState();

    logEvent("task_started", {
        permissionState: {
            audio: audioPermission,
            data: dataPermission
        }
    });
    
    if(!audioPermission.remember){
        await askPermission("audio") 
    }
    
    if(!dataPermission.remember){
        await askPermission("data") 
    } 
    if (audioPermission.remember === true) {
      logEvent("popup_skipped_due_to_remember", {
          permissionType: "audio"
      });
    }
    if (dataPermission.remember === true) {
      logEvent("popup_skipped_due_to_remember", {
          permissionType: "data"
      });
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






