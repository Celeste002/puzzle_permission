import { db } from './firebase.js';
import { ref, onValue, set, get } from './lib/firebase-database.js';

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
const mic = document.getElementById("micSphere");
const micTx = document.getElementById("mictx");

let audioPermission = { granted: false, remember: false };
let dataPermission  = { granted: false, remember: false };

const resetBtn = document.getElementById('resetBtn');

let remember = false;
let permissionTime;
let overallTime;

const stateRef = ref(db, "math/state");
const permissions = {
  audio: ref(db, "permission_math/audio"),
  data: ref(db, "permission_math/data")
};

let currentQuestion = 0;
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

let randomQuestion = shuffle([...questions]);
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
      to: "0 0 0",
      dir: "alternate",
      dur: 600,
      loop: true,
      easing: "easeInOutSine"
    });
    mic.setAttribute("color", "rgba(255, 0, 0, 1)");
  } 
}
// ===================================================
// 🔹 POPUP LOGIK
// ===================================================
function showPopup(title, message, onAllow, onDeny) {

  popup.setAttribute("visible", "true");
  popupHead.setAttribute("value", title);
  popupText.setAttribute("value", message);
  permissionBtn.classList.remove("clickable");

  allowBtn.onclick = async () => {
    popup.setAttribute("visible", "false");
    if (onAllow) await onAllow();
  };

  denyBtn.onclick = async () => {
    popup.setAttribute("visible", "false");
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
async function askAllPermissions() {
  await askPermission("audio");
  await askPermission("data");
}

async function askPermission(type) {
  const popupConfig = {
    audio: {
      title: "Mikrofonzugriff erlauben?",
      message: "Diese Anwendung nutzt dein Mikrofon, um Sprachinteraktionen oder Audiofeedback zu ermöglichen. \n Die Aufnahmen werden nicht gespeichert oder an Dritte weitergegeben.\n Magst du den Zugriff erlauben?",
    },
    data: {
      title: "Datenspeicherung erlauben?",
      message: "Diese Anwendung kann deinen Quiz-Fortschritt speichern, damit du später weiterspielen kannst.\n\n" +
               "Die Daten werden nicht an Dritte weitergegeben und können jederzeit über den Reset-Button gelöscht werden.\n\n" +
               "Magst du die Speicherung deines Fortschritts erlauben?",
    }
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

    if (allPermissionsDenied() && allRememberDenied()) {
        await askAllPermissions();
    } else if(!audioPermission.granted && !audioPermission.remember){
        await askPermission("audio") 
    }
    else if(!dataPermission.granted && !dataPermission.remember){
        await askPermission("data")
        
    }  
    pulseMic(audioPermission.granted)
    startQuiz();
});
function allPermissionsDenied() {
  return !audioPermission.granted && !dataPermission.granted;
}
function allRememberDenied() {
  return !audioPermission.remember && !dataPermission.remember;
}
// ===================================================
// 🔹 QUIZ LOGIK
// ===================================================

function shuffle(array) {
  let currentIndex = array.length, randomIndex;
  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex], array[currentIndex]
    ];
  }
  return array;
}

async function startQuiz() {
  startEntity.setAttribute("visible", "false");
  permissionBtn.setAttribute("visible", "false");
  quizContainer.setAttribute("visible", "true");
  plane.classList.remove("clickable");
  allowBtn.classList.remove("clickable");
  denyBtn.classList.remove("clickable");
    micTx.setAttribute("visible","true")
  mic.setAttribute("visible","true")
  setTimeout(() => micTx.setAttribute("visible","false"), 2000);
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

  if (currentQuestion >= questions.length) {
    showResult();
    
    return;
  }

  const q = randomQuestion[currentQuestion];
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
      }

      await set(stateRef, {
        currentQuestion: currentQuestion + 1,
        answers: userAnswers,
        timestamp: new Date().toISOString(),
      });
      if(dataPermission.granted){
        showSyncNoticeVR();
        }

      setTimeout(() => {
        currentQuestion++;
        loadQuestion();
      }, 1000);
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

  const correct = userAnswers.filter((a) => a === true).length;
  const resultText = `Ergebnis: ${correct} von ${questions.length} richtig!`;
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
    console.log("🔁 Neustart des VR-Puzzles gestartet...");

  // UI zurücksetzen
  const winBox = document.getElementById("quizWin");
  winBox.setAttribute("visible", "false");
  micTx.setAttribute("visible","false")
  mic.setAttribute("visible","false")
  await set(stateRef, { currentQuestion: 0, score: 0 });
  currentQuestion = 0;
  score = 0;

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
