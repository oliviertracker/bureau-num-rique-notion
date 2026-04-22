export async function registerSW(){
  if(!("serviceWorker" in navigator)) return;
  try{
    await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
  } catch(e){
    // no-op
  }
}
registerSW();
