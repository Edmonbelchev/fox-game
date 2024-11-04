import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyDthHQBX0rdbjenyl3IdPI9BnI-Wu81k3E",
  authDomain: "fox-spy-game.firebaseapp.com",
  projectId: "fox-spy-game",
  storageBucket: "fox-spy-game.firebasestorage.app",
  messagingSenderId: "724203554660",
  appId: "1:724203554660:web:31b54137c0bb6fb9d41c71",
  measurementId: "G-G14TTVYJS8",
  databaseURL: "https://fox-spy-game-default-rtdb.europe-west1.firebasedatabase.app",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
const auth = getAuth(app);
const database = getDatabase(app);

export { auth, database };
