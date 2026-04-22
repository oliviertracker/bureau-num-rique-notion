import { dbGetAll, dbUpsert, dbDelete, dbClear } from "./db.js";
import { runOCR, guessFromText } from "./ocr.js";

const fmtEUR = new Intl.NumberFormat("fr-FR", { style:"currency", currency:"EUR" });
const todayISO = () => new Date().toISOString().slice(0,10);

const DRAWERS = [
  { key:"FACTURE", label:"🧾 Factures", hint:"Classement par entreprise" },
  { key:"PAIE", label:"👤 Fiches de paie", hint:"Salaires, attestations" },
  { key:"IMPOT", label:"🏛️ Impôts", hint:"Avis, prélèvements" },
  { key:"TVA", label:"🧮 TVA", hint:"Déclarations, justificatifs" },
];

const state = {
  docs: [],
  activeDrawer: "FACTURE",
  filters: { q:"", from:"", to:"", sort:"date_desc" }
};

// DOM
const drawerBtns = document.getElementById("drawerBtns");
const cards = document.getElementById("cards");
const kpis = document.getElementById("kpis");

const q = document.getElementById("q");
const fromDate = document.getElementById("fromDate");
const toDate = document.getElementById("toDate");
const sort = document.getElementById("sort");

const activeDrawerLabel = document.getElementById("activeDrawerLabel");
const periodLabel = document.getElementById("periodLabel");
const sumLabel = document.getElementById("sumLabel");

const btnToday = document.getElementById("btnToday");
const btnThisMonth = document.getElementById("btnThisMonth");
const btnAll = document.getElementById("btnAll");

const btnNew = document.getElementById("btnNew");
const btnExport = document.getElementById("btnExport");
const importFile = document.getElementById("importFile");
const btnReset = document.getElementById("btnReset");

const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const btnClose = document.getElementById("btnClose");

const docType = document.getElementById("docType");
const company = document.getElementById("company");
const docDate = document.getElementById("docDate");
const amount = document.getElementById("amount");
const tags = document.getElementById("tags");
const title = document.getElementById("title");
const note = document.getElementById("note");
const file = document.getElementById("file");
const preview = document.getElementById("preview");
const btnSave = document.getElementById("btnSave");
const btnDelete = document.getElementById("btnDelete");

const btnOcr = document.getElementById("btnOcr");
const ocrStatus = document.getElementById("ocrStatus");

const toast = document.getElementById("toast");

// Audio
let mediaRecorder = null;
let audioChunks = [];
let currentAudioDataUrl = null;
let audioEl = new Audio();
const btnRec = document.getElementById("btnRec");
const btnStop = document.getElementById("btnStop");
const btnPlay = document.getElementById("btnPlay");
const btnClearAudio = document.getElementById("btnClearAudio");

// Editing
let editingId = null;
let currentFileData = null; // {name,type,dataUrl}

function uid(){
  return "doc_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}
function toastMsg(msg){
  toast.textContent = msg;
  toast.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.style.display = "none", 2200);
}
function drawerLabel(key){
  return DRAWERS.find(d => d.key === key)?.label ?? key;
}
function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function suggestTitle(){
  const t = docType.value;
  const comp = company.value.trim();
  const date = docDate.value || todayISO();
  const frDate = date.split("-").reverse().join("/");
  if(t === "FACTURE") return `Facture ${comp || "Entreprise"} — ${frDate}`;
  if(t === "PAIE") return `Fiche de paie — ${frDate}`;
  if(t === "IMPOT") return `Impôt — ${frDate}`;
  if(t === "TVA") return `TVA — ${frDate}`;
  return `Document — ${frDate}`;
}

function renderDrawer(){
  drawerBtns.innerHTML = "";
  for(const d of DRAWERS){
    const count = state.docs.filter(x => x.type === d.key).length;
    const b = document.createElement("button");
    b.className = (state.activeDrawer === d.key) ? "active" : "";
    b.innerHTML = `<span>${d.label}<div class="muted" style="font-weight:650; font-size:12px; margin-top:2px">${d.hint}</div></span>
                   <span class="count">${count}</span>`;
    b.addEventListener("click", () => {
      state.activeDrawer = d.key;
      render();
    });
    drawerBtns.appendChild(b);
  }
}

function withinDate(doc){
  const d = doc.date || "";
  const from = state.filters.from || "";
  const to = state.filters.to || "";
  if(from && d < from) return false;
  if(to && d > to) return false;
  return true;
}

function matchesQuery(doc){
  const query = (state.filters.q || "").trim().toLowerCase();
  if(!query) return true;
  const hay = [
    doc.title, doc.company, doc.note,
    (doc.tags || []).join(" "),
    doc.type
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(query);
}

function sortDocs(list){
  const s = state.filters.sort;
  const copy = [...list];
  const amountVal = x => Number(x.amount ?? 0);
  if(s === "date_desc") copy.sort((a,b) => (b.date||"").localeCompare(a.date||""));
  if(s === "date_asc") copy.sort((a,b) => (a.date||"").localeCompare(b.date||""));
  if(s === "amount_desc") copy.sort((a,b) => amountVal(b) - amountVal(a));
  if(s === "amount_asc") copy.sort((a,b) => amountVal(a) - amountVal(b));
  if(s === "company_asc") copy.sort((a,b) => (a.company||"").localeCompare(b.company||""));
  return copy;
}

function filteredDocs(){
  return sortDocs(state.docs
    .filter(d => d.type === state.activeDrawer)
    .filter(withinDate)
    .filter(matchesQuery)
  );
}

function computeKpis(){
  const all = state.docs.filter(withinDate).filter(matchesQuery);
  const byType = (t) => all.filter(x => x.type === t);
  const sum = (arr) => arr.reduce((acc,x) => acc + Number(x.amount || 0), 0);

  const items = [
    { label:"Documents (période)", value: all.length },
    { label:"Factures", value: byType("FACTURE").length },
    { label:"TVA", value: byType("TVA").length },
    { label:"Total montants (période)", value: fmtEUR.format(sum(all)) }
  ];
  kpis.innerHTML = "";
  for(const it of items){
    const div = document.createElement("div");
    div.className = "kpi";
    div.innerHTML = `<div class="v">${it.value}</div><div class="l">${it.label}</div>`;
    kpis.appendChild(div);
  }
}

function renderCards(){
  const list = filteredDocs();
  cards.innerHTML = "";
  if(list.length === 0){
    cards.innerHTML = `<div class="muted">Aucun document. Clique sur <strong>+ Ajouter</strong>.</div>`;
    return;
  }

  for(const d of list){
    const el = document.createElement("div");
    el.className = "card";

    const date = d.date ? d.date.split("-").reverse().join("/") : "—";
    const amt = (d.amount !== null && d.amount !== undefined && d.amount !== "") ? fmtEUR.format(Number(d.amount)) : "—";
    const tagsTxt = (d.tags && d.tags.length) ? d.tags.join(", ") : "—";
    const companyTxt = d.type === "FACTURE" ? (d.company || "Entreprise non renseignée") : "—";

    el.innerHTML = `
      <div class="top">
        <div>
          <p class="title">${escapeHtml(d.title || "(Sans titre)")}</p>
          <div class="meta">
            <span>📅 ${date}</span>
            <span>💶 ${amt}</span>
            ${d.type === "FACTURE" ? `<span>🏷️ ${escapeHtml(companyTxt)}</span>` : `<span>🏷️ ${drawerLabel(d.type)}</span>`}
          </div>
        </div>
        <span class="pill"><strong>${drawerLabel(d.type)}</strong></span>
      </div>
      <div class="meta">
        <span>Tags: ${escapeHtml(tagsTxt)}</span>
        <span>${d.file ? ("📎 " + escapeHtml(d.file.name)) : "📎 aucun fichier"}</span>
        <span>${d.audio ? "🎙️ note vocale" : "🎙️ —"}</span>
      </div>
      <div class="actions">
        <button class="btn small" data-act="open">Ouvrir</button>
        <button class="btn small" data-act="download" ${d.file ? "" : "disabled"}>Télécharger</button>
        <button class="btn small" data-act="email">Email</button>
        <button class="btn small" data-act="wa">WhatsApp</button>
      </div>
    `;

    el.querySelector('[data-act="open"]').addEventListener("click", () => openModal(d.id));
    el.querySelector('[data-act="download"]').addEventListener("click", () => downloadFile(d));
    el.querySelector('[data-act="email"]').addEventListener("click", () => shareEmail(d));
    el.querySelector('[data-act="wa"]').addEventListener("click", () => shareWhatsApp(d));

    cards.appendChild(el);
  }
}

function renderSummary(){
  activeDrawerLabel.textContent = drawerLabel(state.activeDrawer);

  const f = state.filters.from || "—";
  const t = state.filters.to || "—";
  periodLabel.textContent = `${f} → ${t}`;

  const list = filteredDocs();
  const total = list.reduce((acc,x) => acc + Number(x.amount || 0), 0);
  sumLabel.textContent = fmtEUR.format(total);
}

function render(){
  renderDrawer();
  q.value = state.filters.q;
  fromDate.value = state.filters.from;
  toDate.value = state.filters.to;
  sort.value = state.filters.sort;

  computeKpis();
  renderSummary();
  renderCards();
}

/** Modal **/
function resetModal(){
  editingId = null;
  modalTitle.textContent = "Ajouter un document";
  btnDelete.style.display = "none";

  docType.value = state.activeDrawer || "FACTURE";
  company.value = "";
  docDate.value = todayISO();
  amount.value = "";
  tags.value = "";
  title.value = "";
  note.value = "";
  file.value = "";
  preview.textContent = "Aperçu ici";
  currentFileData = null;

  currentAudioDataUrl = null;
  btnPlay.disabled = true;
  btnClearAudio.disabled = true;

  ocrStatus.textContent = "";
  btnOcr.disabled = false;
}

function openModal(id=null){
  modalBackdrop.style.display = "block";
  resetModal();

  if(id){
    const d = state.docs.find(x => x.id === id);
    if(!d) return;
    editingId = id;
    modalTitle.textContent = "Ouvrir / modifier";
    btnDelete.style.display = "inline-block";

    docType.value = d.type;
    company.value = d.company || "";
    docDate.value = d.date || todayISO();
    amount.value = (d.amount ?? "");
    tags.value = (d.tags || []).join(", ");
    title.value = d.title || "";
    note.value = d.note || "";
    currentFileData = d.file || null;
    currentAudioDataUrl = d.audio || null;

    renderPreviewFromFile(currentFileData);

    btnPlay.disabled = !currentAudioDataUrl;
    btnClearAudio.disabled = !currentAudioDataUrl;
  }
}

function closeModal(){
  modalBackdrop.style.display = "none";
  stopRecordingIfNeeded();
  audioEl.pause();
}

btnNew.addEventListener("click", () => openModal());
btnClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (e) => {
  if(e.target === modalBackdrop) closeModal();
});

function renderPreviewFromFile(f){
  preview.innerHTML = "";
  if(!f){
    preview.textContent = "Aperçu ici";
    return;
  }
  if((f.type || "").includes("pdf")){
    preview.innerHTML = `<div style="text-align:center">
      <div style="font-size:42px">📄</div>
      <div class="muted">${escapeHtml(f.name)}</div>
      <div class="muted" style="font-size:12px; margin-top:6px">PDF stocké localement</div>
    </div>`;
    return;
  }
  if((f.type || "").startsWith("image/")){
    const img = document.createElement("img");
    img.src = f.dataUrl;
    img.alt = f.name;
    preview.appendChild(img);
    return;
  }
  preview.innerHTML = `<div class="muted">Fichier: ${escapeHtml(f.name)}</div>`;
}

function fileToDataUrl(f){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

/** OCR **/
async function applyOCR(){
  if(!currentFileData || !currentFileData.dataUrl){
    toastMsg("Ajoute une photo avant l’OCR.");
    return;
  }
  if((currentFileData.type || "").includes("pdf")){
    toastMsg("OCR PDF: prévu plus tard (conversion PDF→images).");
    return;
  }

  try{
    btnOcr.disabled = true;
    ocrStatus.textContent = "OCR: démarrage…";

    const text = await runOCR(currentFileData.dataUrl, (p) => {
      ocrStatus.textContent = `OCR: ${Math.round(p*100)}%`;
    });

    ocrStatus.textContent = "OCR: analyse…";
    const g = guessFromText(text);

    docType.value = g.typeGuess;

    if(g.typeGuess === "FACTURE" && g.companyCandidate && !company.value.trim()){
      company.value = g.companyCandidate.toUpperCase();
    }

    if(g.amount != null && (amount.value === "" || amount.value == null)){
      amount.value = g.amount;
    }

    if(!title.value.trim()){
      title.value = suggestTitle();
    }

    const existingTags = tags.value.split(",").map(s => s.trim()).filter(Boolean);
    if(!existingTags.includes("ocr")){
      existingTags.push("ocr");
      tags.value = existingTags.join(", ");
    }

    ocrStatus.textContent = "OCR terminé.";
    toastMsg("OCR appliqué (à vérifier).");
  } catch(err){
    console.error(err);
    ocrStatus.textContent = "";
    toastMsg("OCR impossible (photo floue ou iPhone saturé).");
  } finally {
    btnOcr.disabled = false;
  }
}

btnOcr.addEventListener("click", applyOCR);

/** File input: preview + OCR auto **/
file.addEventListener("change", async () => {
  const f = file.files?.[0];
  if(!f){
    currentFileData = null;
    preview.textContent = "Aperçu ici";
    return;
  }

  const dataUrl = await fileToDataUrl(f);
  currentFileData = { name: f.name, type: f.type, dataUrl };
  renderPreviewFromFile(currentFileData);

  if(!title.value.trim()){
    title.value = suggestTitle();
  }

  // OCR automatique seulement si image
  if((currentFileData.type || "").startsWith("image/")){
    // petite pause pour laisser l’UI respirer
    setTimeout(() => applyOCR(), 250);
  }
});

/** Audio **/
btnRec.addEventListener("click", startRecording);
btnStop.addEventListener("click", stopRecording);
btnPlay.addEventListener("click", () => {
  if(!currentAudioDataUrl) return;
  audioEl.src = currentAudioDataUrl;
  audioEl.play();
});
btnClearAudio.addEventListener("click", () => {
  currentAudioDataUrl = null;
  btnPlay.disabled = true;
  btnClearAudio.disabled = true;
  toastMsg("Note vocale effacée.");
});

async function startRecording(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type:"audio/webm" });
      const dataUrl = await blobToDataUrl(blob);
      currentAudioDataUrl = dataUrl;
      btnPlay.disabled = false;
      btnClearAudio.disabled = false;
      toastMsg("Note vocale enregistrée.");
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    btnRec.disabled = true;
    btnStop.disabled = false;
    toastMsg("Enregistrement…");
  } catch(err){
    console.error(err);
    toastMsg("Micro refusé ou indisponible.");
  }
}

function stopRecording(){
  if(mediaRecorder && mediaRecorder.state !== "inactive"){
    mediaRecorder.stop();
  }
  btnRec.disabled = false;
  btnStop.disabled = true;
}

function stopRecordingIfNeeded(){
  if(mediaRecorder && mediaRecorder.state !== "inactive"){
    stopRecording();
  }
  btnRec.disabled = false;
  btnStop.disabled = true;
}

function blobToDataUrl(blob){
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

/** Save/Delete **/
btnSave.addEventListener("click", async () => {
  const t = docType.value;
  const doc = {
    id: editingId ?? uid(),
    type: t,
    company: (t === "FACTURE") ? company.value.trim() : "",
    date: docDate.value || todayISO(),
    amount: amount.value === "" ? null : Number(amount.value),
    tags: tags.value.split(",").map(s => s.trim()).filter(Boolean),
    title: title.value.trim() || suggestTitle(),
    note: note.value.trim(),
    file: currentFileData,   // stocké dans IndexedDB
    audio: currentAudioDataUrl, // stocké dans IndexedDB
    updatedAt: new Date().toISOString()
  };

  if(t === "FACTURE" && !doc.company){
    if(!confirm("Facture sans entreprise. Continuer ?")) return;
  }

  await dbUpsert(doc);

  const idx = state.docs.findIndex(x => x.id === doc.id);
  if(idx >= 0) state.docs[idx] = doc; else state.docs.push(doc);

  state.activeDrawer = doc.type;
  toastMsg(editingId ? "Document mis à jour." : "Document ajouté.");
  render();
  closeModal();
});

btnDelete.addEventListener("click", async () => {
  if(!editingId) return;
  if(!confirm("Supprimer ce document ?")) return;

  await dbDelete(editingId);
  state.docs = state.docs.filter(x => x.id !== editingId);

  render();
  closeModal();
  toastMsg("Document supprimé.");
});

/** Filters **/
q.addEventListener("input", () => { state.filters.q = q.value; render(); });
fromDate.addEventListener("change", () => { state.filters.from = fromDate.value; render(); });
toDate.addEventListener("change", () => { state.filters.to = toDate.value; render(); });
sort.addEventListener("change", () => { state.filters.sort = sort.value; render(); });

btnToday.addEventListener("click", () => {
  const t = todayISO();
  state.filters.from = t;
  state.filters.to = t;
  render();
});
btnThisMonth.addEventListener("click", () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth()+1).padStart(2,"0");
  const first = `${y}-${m}-01`;
  const last = new Date(y, now.getMonth()+1, 0).toISOString().slice(0,10);
  state.filters.from = first;
  state.filters.to = last;
  render();
});
btnAll.addEventListener("click", () => {
  state.filters.from = "";
  state.filters.to = "";
  render();
});

/** Export/Import **/
btnExport.addEventListener("click", async () => {
  const payload = { docs: state.docs };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bureau-numerique-export.json";
  a.click();
  URL.revokeObjectURL(url);
  toastMsg("Export JSON téléchargé.");
});

importFile.addEventListener("change", async () => {
  const f = importFile.files?.[0];
  if(!f) return;
  try{
    const txt = await f.text();
    const data = JSON.parse(txt);
    if(!data || !Array.isArray(data.docs)) throw new Error("Format invalide");
    // Remplace tout (plus simple et propre)
    await dbClear();
    state.docs = [];
    for(const d of data.docs){
      // sécurise les champs
      const doc = {
        id: d.id || uid(),
        type: d.type || "FACTURE",
        company: d.company || "",
        date: d.date || todayISO(),
        amount: d.amount ?? null,
        tags: Array.isArray(d.tags) ? d.tags : [],
        title: d.title || "",
        note: d.note || "",
        file: d.file || null,
        audio: d.audio || null,
        updatedAt: new Date().toISOString()
      };
      await dbUpsert(doc);
      state.docs.push(doc);
    }
    toastMsg("Import réussi.");
    render();
  } catch(e){
    console.error(e);
    toastMsg("Import impossible (JSON invalide).");
  } finally {
    importFile.value = "";
  }
});

btnReset.addEventListener("click", async () => {
  if(!confirm("Tout effacer (documents) ?")) return;
  await dbClear();
  state.docs = [];
  render();
  toastMsg("Tout a été effacé.");
});

/** Share **/
function shareEmail(d){
  const subject = encodeURIComponent(`[${drawerLabel(d.type)}] ${d.title || "Document"}`);
  const lines = [];
  lines.push(`Titre: ${d.title || ""}`);
  lines.push(`Type: ${drawerLabel(d.type)}`);
  if(d.type === "FACTURE") lines.push(`Entreprise: ${d.company || ""}`);
  lines.push(`Date: ${d.date || ""}`);
  lines.push(`Montant: ${d.amount != null ? fmtEUR.format(Number(d.amount)) : ""}`);
  lines.push(`Tags: ${(d.tags || []).join(", ")}`);
  lines.push("");
  lines.push(d.note || "");
  lines.push("");
  lines.push("Pièce jointe: ouvre le document puis clique sur Télécharger, et joins-le à l’email.");
  const body = encodeURIComponent(lines.join("\n"));
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

function shareWhatsApp(d){
  const textLines = [];
  textLines.push(`[${drawerLabel(d.type)}] ${d.title || "Document"}`);
  if(d.type === "FACTURE") textLines.push(`Entreprise: ${d.company || ""}`);
  textLines.push(`Date: ${d.date || ""}`);
  if(d.amount != null) textLines.push(`Montant: ${fmtEUR.format(Number(d.amount))}`);
  if(d.tags && d.tags.length) textLines.push(`Tags: ${d.tags.join(", ")}`);
  if(d.note) textLines.push(`Note: ${d.note}`);
  textLines.push("");
  textLines.push("Pièce jointe: télécharge le fichier depuis l’app, puis ajoute-le dans WhatsApp.");
  const text = encodeURIComponent(textLines.join("\n"));
  window.open(`https://wa.me/?text=${text}`, "_blank");
}

function downloadFile(d){
  if(!d.file) return;
  const a = document.createElement("a");
  a.href = d.file.dataUrl;
  a.download = d.file.name || "document";
  a.click();
  toastMsg("Téléchargement lancé.");
}

/** Render cards handlers **/
function renderActions(el, d){
  el.querySelector('[data-act="open"]').addEventListener("click", () => openModal(d.id));
  el.querySelector('[data-act="download"]').addEventListener("click", () => downloadFile(d));
  el.querySelector('[data-act="email"]').addEventListener("click", () => shareEmail(d));
  el.querySelector('[data-act="wa"]').addEventListener("click", () => shareWhatsApp(d));
}

/** Init **/
async function init(){
  state.docs = await dbGetAll();
  // valeurs par défaut UI
  docDate.value = todayISO();
  render();
}
init();
