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

// Used before sign-in (and after sign-out) so the app is fully usable without
// an account — data just stays on this device until/unless the user signs in,
// at which point it's carried over to Firestore (see App.jsx).
const LOCAL_KEY = 'in-stock-data';

export function loadLocalData() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      items: parsed && Array.isArray(parsed.items) ? parsed.items : [],
      events: parsed && Array.isArray(parsed.events) ? parsed.events : [],
      salesDays: parsed && Array.isArray(parsed.salesDays) ? parsed.salesDays : [],
    };
  } catch (e) {
    console.error('Failed to read local data', e);
    return { items: [], events: [], salesDays: [] };
  }
}

export function saveLocalData(data) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save local data', e);
  }
}
