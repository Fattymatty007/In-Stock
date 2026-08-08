import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase web config. The apiKey here is NOT a secret — it only identifies the
// project. Access is enforced by Firestore security rules and the Authentication
// -> Authorized domains list, so it's safe to commit (same approach as Dinner Bell).
const firebaseConfig = {
  apiKey: 'AIzaSyBBlFX1zgjtLsSK7wT8hqUIMpGrqbY1quI',
  authDomain: 'in-stock-bbc23.firebaseapp.com',
  projectId: 'in-stock-bbc23',
  storageBucket: 'in-stock-bbc23.firebasestorage.app',
  messagingSenderId: '331777570419',
  appId: '1:331777570419:web:a9b46c31760b44dfcf5c06',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
