const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

function loadTesseract(){
  return new Promise((resolve, reject) => {
    if(window.Tesseract) return resolve(window.Tesseract);
    const s = document.createElement("script");
    s.src = TESSERACT_URL;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Heuristiques simples (on peut améliorer ensuite)
export function guessFromText(textRaw){
  const text = (textRaw || "").toLowerCase();

  const typeGuess =
    (text.includes("tva") || text.includes("déclaration de tva")) ? "TVA" :
    (text.includes("bulletin de paie") || text.includes("net a payer") || text.includes("net à payer") || text.includes("salaire")) ? "PAIE" :
    (text.includes("impôt") || text.includes("impots") || text.includes("direction générale des finances publiques") || text.includes("dgfip")) ? "IMPOT" :
    "FACTURE";

  const amountMatch = text.match(/(\d{1,7}[,.]\d{2})\s*(€|eur)?/);
  const amount = amountMatch ? Number(amountMatch[1].replace(",", ".")) : null;

  const lines = textRaw.split("\n").map(s => s.trim()).filter(Boolean);
  const companyCandidate = (lines.find(l => {
    const low = l.toLowerCase();
    if(low.length < 3) return false;
    if(low.includes("facture")) return false;
    if(low.includes("tva")) return false;
    if(low.includes("imp")) return false;
    if(low.includes("bulletin")) return false;
    if(/^\d+$/.test(low)) return false;
    return true;
  }) || "").slice(0, 60);

  return { typeGuess, amount, companyCandidate };
}

export async function runOCR(dataUrl, onProgress){
  const Tesseract = await loadTesseract();
  const { data } = await Tesseract.recognize(dataUrl, "fra", {
    logger: (m) => {
      if(m.status === "recognizing text" && m.progress != null && onProgress){
        onProgress(m.progress);
      }
    }
  });
  return data.text || "";
}
