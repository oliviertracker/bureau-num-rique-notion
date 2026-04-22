const DB_NAME = "bureauNumeriqueDB";
const DB_VERSION = 1;
const STORE = "documents";

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE)){
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("type", "type", { unique:false });
        store.createIndex("date", "date", { unique:false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    const res = fn(s);
    t.oncomplete = () => resolve(res);
    t.onerror = () => reject(t.error);
  });
}

export async function dbGetAll(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const s = t.objectStore(STORE);
    const req = s.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function dbUpsert(doc){
  return tx("readwrite", (s) => s.put(doc));
}

export async function dbDelete(id){
  return tx("readwrite", (s) => s.delete(id));
}

export async function dbClear(){
  return tx("readwrite", (s) => s.clear());
}
