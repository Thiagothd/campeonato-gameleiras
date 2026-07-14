/* =========================================================================
   DB — Conexão com o Firebase (banco em nuvem + "login" por senha única)
   -------------------------------------------------------------------------
   - Todos LEEM em tempo real (o site atualiza sozinho quando alguém salva).
   - Só quem digita a senha do Gerenciador consegue ESCREVER (entra por baixo
     dos panos numa conta administradora única — sem tela de login).
   Você não precisa mexer aqui.
   ========================================================================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  doc, onSnapshot, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCG9B2Xezcd_TP1ktGrqaSAvIfglrAkpRQ",
  authDomain: "campeonato-gameleiras.firebaseapp.com",
  projectId: "campeonato-gameleiras",
  storageBucket: "campeonato-gameleiras.firebasestorage.app",
  messagingSenderId: "696073836015",
  appId: "1:696073836015:web:167574fbac7c1d8465d21a"
};

// E-mail "de sistema" da conta administradora única (crie este usuário no
// Authentication). A senha é a que os organizadores digitam no Gerenciador.
const ADMIN_EMAIL = "admin@gameleiras.com";

// Onde os dados ficam: coleção "campeonato", documento "dados" (um doc só).
const COLECAO = "campeonato";
const DOCUMENTO = "dados";

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() })
});
const auth = getAuth(app);
const ref = doc(db, COLECAO, DOCUMENTO);

const CampDB = {
  /** Escuta os dados em tempo real. cb(dados|null, erro?). Retorna unsubscribe. */
  onDados(cb) {
    return onSnapshot(ref,
      { includeMetadataChanges: false },
      (snap) => cb(snap.exists() ? snap.data() : null),
      (err) => cb(null, err));
  },
  /** Lê uma vez (usado pra saber se o banco já foi semeado). */
  async lerUmaVez() {
    const s = await getDoc(ref);
    return s.exists() ? s.data() : null;
  },
  /** Salva o estado completo (substitui o documento). Só funciona logado. */
  async salvar(dados) {
    await setDoc(ref, dados);
  },
  /** "Login" invisível: entra na conta admin com a senha digitada. */
  async entrar(senha) {
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, senha);
  },
  async sair() { await signOut(auth); },
  estaLogado() { return !!auth.currentUser; },
  aoMudarLogin(cb) { onAuthStateChanged(auth, (u) => cb(!!u)); }
};

window.CampDB = CampDB;
window.dispatchEvent(new Event("campdb-pronto"));
