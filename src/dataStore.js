import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';

// Each signed-in user gets exactly one document holding their whole app state
// (items, events, salesDays together). This mirrors the single-key approach that
// proved most reliable during testing: one atomic read, one atomic write, no risk
// of two collections stepping on each other mid-save.
function userDocRef(uid) {
  return doc(db, 'users', uid, 'data', 'store');
}

// Subscribes to this user's data in real time. onData is called with
// { items, events, salesDays } whenever it changes — including right after this
// app's own writes — or with null if no document exists yet (a brand new user).
// Returns an unsubscribe function; call it on sign-out / unmount.
export function subscribeUserData(uid, onData, onError) {
  return onSnapshot(
    userDocRef(uid),
    (snap) => onData(snap.exists() ? snap.data() : null),
    (err) => {
      console.error('Firestore subscription error', err);
      if (onError) onError(err);
    }
  );
}

export async function saveUserData(uid, data) {
  try {
    await setDoc(userDocRef(uid), data);
    return true;
  } catch (e) {
    console.error('Failed to save to Firestore', e);
    return false;
  }
}
