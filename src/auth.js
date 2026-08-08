import { signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth, googleProvider } from './firebase';

export async function signInWithGoogle() {
  try {
    await signInWithPopup(auth, googleProvider);
    return true;
  } catch (e) {
    // e.code === 'auth/popup-closed-by-user' just means they backed out — not an error worth logging.
    if (e && e.code !== 'auth/popup-closed-by-user') {
      console.error('Sign in failed', e);
    }
    return false;
  }
}

export async function signOutUser() {
  try {
    await firebaseSignOut(auth);
    return true;
  } catch (e) {
    console.error('Sign out failed', e);
    return false;
  }
}
