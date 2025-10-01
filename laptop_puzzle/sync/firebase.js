// Realtime-Kommunikation

// Import the functions from the SDKs 

import { initializeApp } from './lib/firebase-app.js';
import { getDatabase } from './lib/firebase-database.js';

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
apiKey: "AIzaSyBMnalYVBypC-xA6kyi_31y7hFgaLSZtKU",
authDomain: "permissionverwaltung.firebaseapp.com",
databaseURL: "https://permissionverwaltung-default-rtdb.europe-west1.firebasedatabase.app",
projectId: "permissionverwaltung",
storageBucket: "permissionverwaltung.firebasestorage.app",
messagingSenderId: "694700990399",
appId: "1:694700990399:web:daac7477171f5aa1318b0a",
measurementId: "G-W51KNVRRBP"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
//const analytics = getAnalytics(app);
const db = getDatabase(app);

export { db, app };