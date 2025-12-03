import { db } from './firebase.js';
import { ref, onValue, set, get, push } from './lib/firebase-database.js';

const permissionBtn = document.getElementById('permissionBtn');
const plane = document.getElementById('plane');
const startEntity = document.getElementById('startEntity');
const quizContainer = document.getElementById('quizContainer');
const questionText = document.getElementById('questionText');
const quizWin = document.getElementById('quizWin');
const quizResult = document.getElementById('quizResult');

// Popup Elemente
const popup = document.getElementById('popup-wrapper');
const popupText = document.getElementById('popup-text');
const popupHead = document.getElementById('popup-head');
const allowBtn = document.getElementById('popup-allow');
const denyBtn = document.getElementById('popup-deny');
const rememberBox = document.getElementById('rememberBox');
const rememberCheck = document.getElementById('rememberCheck');
const micLamp = document.getElementById("micLamp");
const mic = document.getElementById("micSphere");
const statusAudioStart = document.getElementById('statusAudioStart');
const statusDataStart = document.getElementById('statusDataStart'); 
const statusAudioGame = document.getElementById('statusAudioGame'); 
const statusDataGame = document.getElementById('statusDataGame'); 
const solvedTasksDisplay = document.getElementById('solvedTasksDisplay');

let audioPermission = { granted: false, remember: false };
let dataPermission  = { granted: false, remember: false };

const resetBtn = document.getElementById('resetBtn');

let remember = false;
let permissionTime;
let overallTime;
let permissionPopupStartTime = null;
let taskStartTime = 0;

let counter=0;

const stateRef = ref(db, "math/state");
const permissions = {
  audio: ref(db, "permission_math/audio"),
  data: ref(db, "permission_math/data")
};

let currentQuestion =  0;
let userAnswers = [];
let score=0;

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

//let randomQuestion = shuffle([...questions]);

// -------------------- Session ID --------------------
// ---- SESSION ID HANDLING ----
function newSessionId() {
    return "S_vr_Math_" + counter++;
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
        device: "VR",
        ...details
    });
    console.log("[LOG]", eventType, details);
}
function getRandomInt(max) {
  return Math.floor(Math.random() * max);
}
function logDur(event) {
  let TASK_TIME_REF = ref(db, 'sessions/' + 'VR_Mathe_'+ getRandomInt(1000) + '/taskStartTime');
    push(TASK_TIME_REF, {
        event: event,
        duration: ((Date.now()-taskStartTime)/1000).toFixed(2),
        device: "vr"
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
//  🔄 LOAD PROGRESS BUTTON (VR)
// ------------------------------
const vrLoadBtn = document.getElementById("loadProgressBtn");

async function vrLoadProgress() {

  if (!dataPermission.granted) {
      showSyncNoticeVR("Laden fehlgeschlagen: Datenspeicherung nicht erlaubt.");
      return;
  }
    console.log("🔄 VR lädt Fortschritt...");

    await loadExistingState();
    loadQuestion();
    console.log("✅ VR hat Fortschritt geladen:", state);
    showSyncNoticeVR("Fortschritt geladen");
    // Logging
    logEvent("manual_load", {
        questionIndex: currentQuestion,
        score
    });
}

vrLoadBtn.addEventListener("click", vrLoadProgress);

/**
 * Aktualisiert die Farbe und Sichtbarkeit der Status-Indikatoren (Ampel-Logik).
 */
function updatePermissionIndicators() {
    
    const audioGranted = audioPermission.granted;
    const dataGranted = dataPermission.granted;

    const audioColor = audioGranted ? 'green' : 'red';
    const dataColor = dataGranted ? 'green' : 'red';
    
    // 1. Startbildschirm-Indikatoren (Groß)
    statusAudioStart.setAttribute('material', 'color', audioColor);
    statusDataStart.setAttribute('material', 'color', dataColor);
    
    // 2. In-Game-Indikatoren (Klein)
    statusAudioGame.setAttribute('material', 'color', audioColor);
    statusDataGame.setAttribute('material', 'color', dataColor);
    
    // Stellen Sie sicher, dass die In-Game Indikatoren sichtbar sind, wenn das Spiel startet
    if (statusAudioGame.getAttribute('visible') === 'false') {
        statusAudioGame.setAttribute('visible', 'true');
        statusDataGame.setAttribute('visible', 'true');
    }
}
// -------------------- Helper: Sync Notice --------------------
function showSyncNoticeVR(msg) {

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
    
    to: "1 1 1.1",
    dir: "alternate",
    dur: 600,
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
  console.log("Mikrofon-Pulsieren:", active);
  if (!micLamp) return;
  if (active) {
    micLamp.setAttribute("animation__pulse", {
      property: "scale",
      to: "0 0 0",
      dir: "alternate",
      dur: 1000,
      loop: true,
      easing: "easeInOutSine"
    });
    mic.setAttribute("color", "rgba(255, 0, 0, 1)");
  }
}
// ===================================================
// 🔹 POPUP LOGIK
// ===================================================
function showPopup(type, title, message, onAllow, onDeny) {

  remember = false;
  rememberCheck.setAttribute("visible", remember);
  permissionPopupStartTime = Date.now();

  logEvent("popup_shown", {
        title: title,
        permissionType: type
    });

  popup.setAttribute("visible", "true");
  popupHead.setAttribute("value", title);
  popupText.setAttribute("value", message);
  permissionBtn.classList.remove("clickable");

  allowBtn.onclick = async () => {
    popup.setAttribute("visible", "false");

     logEvent("permission_answer", {
        permissionType: type,
        granted: true,
        remember: remember,
        responseTime: ((Date.now() - permissionPopupStartTime)/ 1000).toFixed(2)
      });

    if (onAllow) await onAllow();
  };

  denyBtn.onclick = async () => {
    popup.setAttribute("visible", "false");

    logEvent("permission_answer", {
        permissionType: type,
        granted: false,
        remember: remember,
        responseTime: ((Date.now() - permissionPopupStartTime)/ 1000).toFixed(2)
      });

    if (onDeny) await onDeny();
  };

  rememberBox.onclick = () => {
    remember = !remember;
    rememberCheck.setAttribute("visible", remember);
  };
}

// ===================================================
// 🔹 PERMISSION ABFRAGEN
// ===================================================

async function askPermission(type) {
  const popupConfig = {
    audio: {
      title: "Mikrofonzugriff erlauben?",
      message: "Diese Anwendung nutzt dein Mikrofon, um Audiofeedback zuzulassen. \n Die Aufnahmen werden nicht gespeichert oder an Dritte weitergegeben.\n Magst du den Zugriff erlauben?",
    },
    data: {
      title: "Datenspeicherung erlauben?",
      message: "Diese Anwendung kann deinen Quiz-Fortschritt speichern, damit du zu einem anderen Zeitpunkt weiterspielen kannst.\n" +
                "Die Daten werden nicht an Dritte weitergegeben und sind jederzeit mit den Reset-Button widerrufbar.\n\n" +
                "Magst du die Speicherung deines Fortschritts erlauben?",
    }
  };

  const { title, message } = popupConfig[type];
  return new Promise((resolve) => {
    showPopup(
      type,
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
    updatePermissionIndicators();
    resetBtn.removeAttribute('animation__pulse');
    resetBtn.setAttribute('color', val?.granted ? '#0f0' : '#f00');
    resetBtn.setAttribute('animation__pulse', {
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
async function updatePermissionsInFirebase(type, granted, remember = false) {
  const refPath = permissions[type];
  await set(refPath, {
    granted: granted,
    remember: remember,
    permType: type,
    timestamp: new Date().toISOString(),
    source: "vr"
  });
  console.log(`VR Permission für ${type}:`, granted, remember);
}

// ===================================================
// 🔹 START BUTTON LOGIK
// ===================================================
plane.addEventListener("click", async (e) => {
    permissionTime = Date.now();
    overallTime = Date.now();
    taskStartTime = Date.now();

    await startStudySession()

    // zuerst vorhandenen Stand aus Firebase laden
    await loadExistingState();

     logEvent("task_started", {
        permissionState: {
            audio: audioPermission,
            data: dataPermission
        }
    });
 
    if( !audioPermission.remember){
        await askPermission("audio") 
    }else{
        logEvent("popup_skipped_due_to_remember", {
            permissionType: "audio"
        });
    }
    if(!dataPermission.remember){
        await askPermission("data") 
    } 
    else{
      logEvent("popup_skipped_due_to_remember", {
          permissionType: "data"
      });
    }

    pulseMic(audioPermission.granted)
    startQuiz();
});
// ===================================================
// 🔹 QUIZ LOGIK
// ===================================================

async function startQuiz() {

  startEntity.setAttribute("visible", "false");
  permissionBtn.setAttribute("visible", "false");
  quizContainer.setAttribute("visible", "true");
  plane.classList.remove("clickable");
  allowBtn.classList.remove("clickable");
  denyBtn.classList.remove("clickable");

  if(audioPermission.granted){

    micLamp.setAttribute("visible","true")
  }
  statusAudioGame.setAttribute('visible', 'true');
  statusDataGame.setAttribute('visible', 'true');
  statusAudioStart.setAttribute('visible', 'false');
  statusDataStart.setAttribute('visible', 'false');
  

  updatePermissionIndicators();
  loadQuestion();
}

function loadQuestion() {

  vrLoadBtn.setAttribute("visible", true);

  const value = `Aufgabe: ${currentQuestion} / ${questions.length}`;
  solvedTasksDisplay.setAttribute('value', value);

  if (currentQuestion >= questions.length) {
    showResult();
    
    return;
  }

  const q = questions[currentQuestion];
  questionText.setAttribute("value", q.q);
  
  const answerButtons = document.querySelectorAll('.answer');
  answerButtons.forEach((btn, i) => {
    btn.classList.add("clickable")
    btn.setAttribute("color", "#2563eb");
    btn.setAttribute("visible", "true");
    const label = btn.querySelector("a-text");
    label.setAttribute("value", q.answers[i]);

    btn.onclick = async () => {
      if (i === q.correct) {
        btn.setAttribute("color", "#22c55e");
        userAnswers[currentQuestion] = true;
        score ++;
      } else {
        btn.setAttribute("color", "#ef4444");
        userAnswers[currentQuestion] = false;

        logEvent("error", {
        type: "wrong_answer",
        question: currentQuestion,
        chosen: i,
        correctAnswer: q.correct
      });
      }
      logDur(currentQuestion),
      logEvent("task_completed", {
        question: currentQuestion,
        duration: ((Date.now() - taskStartTime)/ 1000).toFixed(2)
      });
      
      if(dataPermission.granted){
          showSyncNoticeVR("Fortschritt gespeichert");
      }
      else{
            showSyncNoticeVR("Speichern fehlgeschlagen: Datenspeicherung nicht erlaubt.");
      }
      
      setTimeout(async () => {
        currentQuestion++;
        if (dataPermission.granted) {
            await set(stateRef, {
                currentQuestion,
                score
            }); 
        }
        
        loadQuestion();
      }, 1200);
    };
  });
}

function showResult() {

    const endTime = Date.now();
    const quizDuration=((endTime-overallTime)/1000).toFixed(2);

  quizContainer.setAttribute("visible", "false");
  quizWin.setAttribute("visible", "true");
    const restartButton = document.getElementById("restartButtonVR");
    restartButton.setAttribute("visible", "true");
    const answerButtons = document.querySelectorAll('.answer');
  answerButtons.forEach((btn) => {
    btn.classList.remove("clickable")
  })
  logDur("solved");
  const correct = userAnswers.filter((a) => a === true).length;
  const resultText = `Ergebnis: ${score} von ${questions.length} richtig!`;
  quizResult.setAttribute("value", resultText);
  console.log("Quiz beendet:", resultText);
  console.log("Quiz beendet:", quizDuration);

  restartButton.addEventListener("click", async (e) => {
            e.stopPropagation();
            console.log("🔁 Restart button clicked!");
            await restartQuiz();
    });
}
async function restartQuiz(){
console.log("🔁 Neustart des VR-Mathe-Quiz gestartet...");

  // UI zurücksetzen
  const winBox = document.getElementById("quizWin");
  winBox.setAttribute("visible", "false");
  micLamp.setAttribute("visible","false")
  await set(stateRef, { currentQuestion: 0, score: 0 });
  currentQuestion = 0;
  score = 0;
  await endStudySession();

  startEntity.setAttribute("visible", "true");
  permissionBtn.setAttribute("visible", "true");
  plane.classList.add("clickable");
  allowBtn.classList.add("clickable");
  denyBtn.classList.add("clickable");
  vrLoadBtn.setAttribute("visible", false);
  statusAudioStart.setAttribute('visible', 'true');
  statusDataStart.setAttribute('visible', 'true');
  // Permissions zurücksetzen, wenn nicht "merken"

  if(!audioPermission.remember){
      audioPermission.granted==false
      updatePermissionIndicators();
      await updatePermissionsInFirebase('audio', false, false);
  }
  if(!dataPermission.remember){
      dataPermission.granted==false
      updatePermissionIndicators();
      await updatePermissionsInFirebase('data', false, false);
  }
}

// ===================================================
// 🔹 RESET BUTTON
// ===================================================
if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
    await set(stateRef, { currentQuestion: 0, answers: [], score: 0 });
    await set(permissions.data, {
    granted: false,
    remember: false,
    permType: "data",
    timestamp: new Date().toISOString(),
    source: "vr"
  });
    await set(permissions.audio, {
    granted: false,
    remember: false,
    permType: "audio",
    timestamp: new Date().toISOString(),
    source: "vr"
  });
  
    console.log("Quiz & Permissions zurückgesetzt!");
    quizContainer.setAttribute("visible", "false");
    quizWin.setAttribute("visible", "false");
    startEntity.setAttribute("visible", "true");
    permissionBtn.setAttribute("visible", "true");
  });
}

initPermissionListeners();






