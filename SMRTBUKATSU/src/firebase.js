// 必ず自分のFirebaseプロジェクトの値に差し替え
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDxM4skyoBwXHIUFn_bCqTfIeW3mRbtvvA',
  authDomain: 'smart-bukatsu.firebaseapp.com',
  projectId: 'smart-bukatsu',
  storageBucket: 'smart-bukatsu.firebasestorage.app',
  messagingSenderId: '217234021892',
  appId: '1:217234021892:web:9a0313f0620b0c88e31f51',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
