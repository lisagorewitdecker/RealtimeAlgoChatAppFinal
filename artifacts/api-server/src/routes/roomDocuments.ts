/**
 * The two documents this server hands to the chat app: the call page and the
 * collaborative sandbox page.
 *
 * Each is built from its arguments alone — no database, no socket server, no
 * signed-in account — and routes/rooms.ts sends the result. They live apart
 * from that router so a check can build and render a document the way the
 * route serves it without opening a connection pool: routes/rooms.bottomClearance.test.ts
 * reads the CSS they declare, and e2e/home-bar-clearance.spec.ts loads them in
 * a browser.
 */
import { HOSTED_BOTTOM_INSET } from "@workspace/hosted-document-inset";
import { getAssistantRateLimitCountdown } from "../lib/assistantErrors";

/**
 * The room a phone's bottom bar needs below a document's last control.
 *
 * These documents fill the chat app's WebView on a device and its iframe in
 * the browser, so the app cannot keep this room on their behalf: padding added
 * around the WebView would shrink the hosted viewport rather than lift the
 * controls inside it. Each document reserves the room itself, from what the
 * platform reports — nothing in a desktop browser, the height of the home
 * indicator or the gesture strip on a phone — rather than from a guessed
 * number that would be dead space everywhere else.
 *
 * The platform reports it two ways, which is why this takes the larger of
 * two. Only an iOS WebView answers `env(safe-area-inset-bottom)` for the bar
 * at the foot of the window, and only once the viewport covers the whole
 * window — so both documents below ask for `viewport-fit=cover`, without
 * which the inset is always zero and the controls sit back under the home
 * indicator. An Android WebView answers nothing for its gesture navigation
 * strip, so the app screen hosting the document hands over the inset it
 * measured, in the custom property @workspace/hosted-document-inset names.
 * See routes/rooms.bottomClearance.test.ts, which fails if any of this goes
 * away.
 */
const HOME_BAR_INSET = HOSTED_BOTTOM_INSET;

/**
 * The room the bars along the sides of a phone's window need beside a
 * document's controls, for a phone held sideways.
 *
 * Turned on its side a phone reports no bar under the page and two beside it:
 * the notch or camera cutout takes whichever edge it landed on, and the home
 * indicator the other. Both float over the page the same way the home bar
 * does below it, so a control drawn to the window's edge ends underneath one
 * — the end-call button under the cutout, the assistant's buttons under the
 * indicator — and the documents reserve that room for the same reason they
 * reserve {@link HOME_BAR_INSET}.
 *
 * Unlike the bottom edge, this is what the platform reports and nothing else.
 * The bottom takes the larger of two reports because a host may be the only
 * side that knows the number — an Android WebView says nothing about its
 * gesture strip, a browser tells a page in an iframe nothing at all — and no
 * host hands over a side inset today. So where nothing is reported these
 * resolve to zero and the document keeps the layout it already has: a desktop
 * browser, and a phone held upright, reserve nothing at either side.
 *
 * Both documents ask for `viewport-fit=cover`, without which every `env()`
 * below is zero on the device that does report one.
 */
const LEFT_INSET = "env(safe-area-inset-left,0px)";

/** The room at the window's right edge. See {@link LEFT_INSET}. */
const RIGHT_INSET = "env(safe-area-inset-right,0px)";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character] ?? character;
  });
}

export function buildCallHtml({
  roomId,
  userId,
  username,
  capability,
}: {
  roomId: string;
  userId: string;
  username: string;
  capability: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no,viewport-fit=cover"><title>Call</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d0d1a;width:100vw;height:100vh;display:flex;flex-direction:column;overflow:hidden;font-family:system-ui,sans-serif}#videos{flex:1;position:relative;background:#0d0d1a;display:flex;align-items:center;justify-content:center}#remoteVideo{width:100%;height:100%;object-fit:cover;background:#161628}#localVideo{position:absolute;bottom:16px;right:calc(16px + ${RIGHT_INSET});width:110px;height:150px;border-radius:14px;object-fit:cover;border:2px solid #6366f1;background:#1e1e3a;z-index:10}#status{position:absolute;top:20px;left:50%;transform:translateX(-50%);color:#a5b4fc;font-size:13px;background:rgba(13,13,26,.75);padding:4px 14px;border-radius:20px;z-index:10;white-space:nowrap}#nameTag{position:absolute;bottom:16px;left:calc(16px + ${LEFT_INSET});color:#f1f0ff;font-size:12px;background:rgba(13,13,26,.8);padding:4px 12px;border-radius:20px;z-index:10}#controls{display:flex;justify-content:center;gap:18px;padding:16px 24px;padding-bottom:calc(16px + ${HOME_BAR_INSET});padding-left:calc(24px + ${LEFT_INSET});padding-right:calc(24px + ${RIGHT_INSET});background:rgba(13,13,26,.95);border-top:1px solid #2d2d4a}.btn{width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:24px}#muteBtn,#cameraBtn{background:#2d2d4a;color:#fff}#endBtn{background:#ef4444;color:#fff}.btn.toggled{background:#6366f1}</style></head>
<body><div id="videos"><video id="remoteVideo" autoplay playsinline></video><video id="localVideo" autoplay muted playsinline></video><div id="status">Connecting…</div><div id="nameTag">${escapeHtml(username)}</div></div><div id="controls"><button class="btn" id="muteBtn">🎤</button><button class="btn" id="cameraBtn">📷</button><button class="btn" id="endBtn" title="End call">📵</button></div>
 <script src="/api/socket-client.js"></script><script>
const ROOM_ID=${JSON.stringify(roomId)},USER_ID=${JSON.stringify(userId)},CAPABILITY=${JSON.stringify(capability)};
const socket=io({path:'/api/socket.io',auth:{token:CAPABILITY},reconnection:false});
let localStream=null,peers={},muted=false,camOff=false;
const statusEl=document.getElementById('status'),remoteVideo=document.getElementById('remoteVideo'),localVideo=document.getElementById('localVideo'),ICE={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
socket.on('connect_error',()=>statusEl.textContent='Secure connection failed');
async function init(){try{localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});localVideo.srcObject=localStream;statusEl.textContent='Ready — waiting for others'}catch{try{localStream=await navigator.mediaDevices.getUserMedia({video:false,audio:true});statusEl.textContent='Audio only'}catch{statusEl.textContent='No media access'}}socket.emit('join-room',{roomId:ROOM_ID,createIfMissing:true});}
function makePeer(remoteId){const pc=new RTCPeerConnection(ICE);peers[remoteId]=pc;if(localStream)localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));pc.ontrack=e=>{remoteVideo.srcObject=e.streams[0];statusEl.textContent='Connected'};pc.onicecandidate=e=>{if(e.candidate)socket.emit('webrtc-ice',{roomId:ROOM_ID,candidate:e.candidate,to:remoteId})};pc.onconnectionstatechange=()=>{if(['disconnected','failed'].includes(pc.connectionState)){remoteVideo.srcObject=null;statusEl.textContent='Peer disconnected'}};return pc}
socket.on('room-joined',async({users})=>{const others=users.filter(u=>u.userId!==USER_ID);statusEl.textContent=others.length?'Connecting…':'Waiting for others…';for(const o of others){const pc=makePeer(o.userId),offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit('webrtc-offer',{roomId:ROOM_ID,offer,to:o.userId})}});
socket.on('user-left',({userId})=>{if(peers[userId]){peers[userId].close();delete peers[userId]}remoteVideo.srcObject=null;statusEl.textContent='Participant left'});
socket.on('webrtc-offer',async({offer,from})=>{const pc=makePeer(from);await pc.setRemoteDescription(offer);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit('webrtc-answer',{roomId:ROOM_ID,answer,to:from})});
socket.on('webrtc-answer',async({answer,from})=>{const pc=peers[from];if(pc)await pc.setRemoteDescription(answer)});
socket.on('webrtc-ice',async({candidate,from})=>{const pc=peers[from];if(pc&&candidate){try{await pc.addIceCandidate(candidate)}catch{}}});
document.getElementById('muteBtn').onclick=()=>{if(!localStream)return;muted=!muted;localStream.getAudioTracks().forEach(t=>t.enabled=!muted);document.getElementById('muteBtn').textContent=muted?'🔇':'🎤';document.getElementById('muteBtn').classList.toggle('toggled',muted)};
document.getElementById('cameraBtn').onclick=()=>{if(!localStream)return;camOff=!camOff;localStream.getVideoTracks().forEach(t=>t.enabled=!camOff);document.getElementById('cameraBtn').textContent=camOff?'🚫':'📷';document.getElementById('cameraBtn').classList.toggle('toggled',camOff)};
document.getElementById('endBtn').onclick=()=>{socket.emit('leave-room',{roomId:ROOM_ID});Object.values(peers).forEach(p=>p.close());if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:'end-call'}));else history.back()};
init();</script></body></html>`;
}

export function buildSandboxHtml({
  roomId,
  username,
  capability,
}: {
  roomId: string;
  username: string;
  capability: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Sandbox</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d0d1a;color:#f1f0ff;font-family:'Courier New',monospace;height:100vh;display:flex;flex-direction:column;overflow:hidden;padding-bottom:${HOME_BAR_INSET};padding-left:${LEFT_INSET};padding-right:${RIGHT_INSET}}#topbar{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:#161628;border-bottom:1px solid #2d2d4a;min-height:38px}#room-info,#sync-badge{font-size:11px;color:#7c8db0}#sync-badge{color:#22d3ee;background:rgba(34,211,238,.1);padding:2px 8px;border-radius:10px}#tabs{display:flex;background:#161628;border-bottom:1px solid #2d2d4a}.tab{padding:10px 18px;cursor:pointer;font-size:12px;font-weight:600;letter-spacing:.04em;color:#7c8db0;border-bottom:2px solid transparent}.tab.active{color:#6366f1;border-bottom-color:#6366f1}.tab[data-tab="preview"].active{color:#22d3ee;border-bottom-color:#22d3ee}#main{flex:1;display:flex;flex-direction:column;min-height:0}.editor-pane{flex:1;display:none;flex-direction:column}.editor-pane.active{display:flex}textarea{flex:1;width:100%;background:#0d0d1a;color:#f1f0ff;border:none;outline:none;padding:16px;font-family:'Courier New',monospace;font-size:13px;line-height:1.7;resize:none;caret-color:#6366f1}#preview-pane{flex:1;display:none;flex-direction:column}#preview-pane.active{display:flex}#preview-bar{display:flex;justify-content:flex-end;padding:6px 12px;background:#161628;border-bottom:1px solid #2d2d4a}#runBtn{background:#6366f1;color:#fff;border:none;padding:6px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer}#previewFrame{flex:1;border:none;background:#fff}</style></head>
<body><div id="topbar"><span id="room-info">#${escapeHtml(roomId)} · ${escapeHtml(username)}</span><span id="sync-badge">Connecting…</span></div><div id="tabs"><div class="tab active" data-tab="html">HTML</div><div class="tab" data-tab="css">CSS</div><div class="tab" data-tab="js">JS</div><div class="tab" data-tab="preview">▶ Preview</div></div><div id="main"><div class="editor-pane active" id="html-pane"><textarea id="htmlEditor" spellcheck="false"></textarea></div><div class="editor-pane" id="css-pane"><textarea id="cssEditor" spellcheck="false"></textarea></div><div class="editor-pane" id="js-pane"><textarea id="jsEditor" spellcheck="false"></textarea></div><div id="preview-pane"><div id="preview-bar"><button id="runBtn" onclick="runPreview()">▶ Run</button></div><iframe id="previewFrame" sandbox="allow-scripts"></iframe></div></div>
 <script src="/api/socket-client.js"></script><script>
const ROOM_ID=${JSON.stringify(roomId)},CAPABILITY=${JSON.stringify(capability)},socket=io({path:'/api/socket.io',auth:{token:CAPABILITY},reconnection:false}),badge=document.getElementById('sync-badge'),htmlEd=document.getElementById('htmlEditor'),cssEd=document.getElementById('cssEditor'),jsEd=document.getElementById('jsEditor');let timer=null,ignoreNext=false;
socket.on('connect',()=>{badge.textContent='Connected';socket.emit('join-room',{roomId:ROOM_ID,createIfMissing:true})});socket.on('disconnect',()=>badge.textContent='Disconnected');socket.on('connect_error',()=>badge.textContent='Secure connection failed');
socket.on('room-joined',({sandboxState})=>{if(sandboxState){htmlEd.value=sandboxState.html||'';cssEd.value=sandboxState.css||'';jsEd.value=sandboxState.js||''}badge.textContent='Synced'});socket.on('sandbox-update',({html,css,js})=>{ignoreNext=true;htmlEd.value=html;cssEd.value=css;jsEd.value=js;badge.textContent='Updated';setTimeout(()=>badge.textContent='Synced',1200)});
function broadcast(){if(ignoreNext){ignoreNext=false;return}clearTimeout(timer);timer=setTimeout(()=>{socket.emit('sandbox-update',{roomId:ROOM_ID,html:htmlEd.value,css:cssEd.value,js:jsEd.value});badge.textContent='Syncing…';setTimeout(()=>badge.textContent='Synced',600)},350)}[htmlEd,cssEd,jsEd].forEach(el=>el.addEventListener('input',broadcast));document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');const name=tab.dataset.tab;document.querySelectorAll('.editor-pane').forEach(p=>p.classList.remove('active'));document.getElementById('preview-pane').classList.remove('active');if(name==='preview'){document.getElementById('preview-pane').classList.add('active');runPreview()}else document.getElementById(name+'-pane').classList.add('active')}));function runPreview(){const content='<!DOCTYPE html><html><head><style>'+cssEd.value+'<\\/style><\\/head><body>'+htmlEd.value+'<script>'+jsEd.value+'<\\/script><\\/body><\\/html>';document.getElementById('previewFrame').srcdoc=content}</script></body></html>`;
}

export function buildSandboxHtmlWithAssistant(args: {
  roomId: string;
  username: string;
  capability: string;
}): string {
  const panel = `<style>
body{padding-right:340px}#assistant-panel{position:fixed;right:0;top:0;bottom:0;width:340px;display:flex;flex-direction:column;background:#111122;border-left:1px solid #2d2d4a;padding:14px;padding-bottom:calc(14px + ${HOME_BAR_INSET});padding-right:calc(14px + ${RIGHT_INSET});z-index:20;font-family:system-ui,sans-serif}#assistant-panel h2{font-size:14px;margin:0 0 8px;color:#e0e7ff}#assistant-output{flex:1;overflow:auto;white-space:pre-wrap;word-break:break-word;border:1px solid #2d2d4a;border-radius:8px;background:#0d0d1a;padding:10px;font:12px/1.5 ui-monospace,SFMono-Regular,monospace;color:#e2e8f0}#assistant-status{min-height:18px;margin:8px 0;color:#a5b4fc;font-size:12px}#assistant-input{width:100%;min-height:76px;resize:vertical;background:#0d0d1a;color:#f8fafc;border:1px solid #3b3b5b;border-radius:8px;padding:9px;font:12px/1.4 ui-monospace,SFMono-Regular,monospace}#assistant-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.assistant-btn{border:0;border-radius:7px;padding:7px 9px;background:#303052;color:#eef2ff;font-weight:700;font-size:12px;cursor:pointer}.assistant-btn.primary{background:#6366f1}.assistant-btn:disabled{opacity:.55;cursor:not-allowed}@media(max-width:760px){body{padding-right:${RIGHT_INSET};padding-bottom:calc(300px + ${HOME_BAR_INSET})}#assistant-panel{top:auto;width:100%;height:calc(300px + ${HOME_BAR_INSET});border-left:0;border-top:1px solid #2d2d4a;padding-left:calc(14px + ${LEFT_INSET})}}</style>
<aside id="assistant-panel" aria-label="Coding assistant"><h2>Coding assistant</h2><div id="assistant-output" role="log" aria-live="polite" aria-label="Assistant response" tabindex="0"></div><p id="assistant-status" role="status">Ask for help with the current files.</p><label for="assistant-input">Ask about this sandbox</label><textarea id="assistant-input" maxlength="2000" placeholder="Explain a bug, ask for a change, or request a review."></textarea><div id="assistant-actions"><button class="assistant-btn primary" id="assistant-send" type="button">Ask</button><button class="assistant-btn" id="assistant-cancel" type="button" disabled>Cancel</button><button class="assistant-btn" id="assistant-retry" type="button" disabled>Retry</button><button class="assistant-btn" id="assistant-clear" type="button">Clear</button></div></aside>
<script>
(()=>{const input=document.getElementById('assistant-input'),output=document.getElementById('assistant-output'),status=document.getElementById('assistant-status'),send=document.getElementById('assistant-send'),cancel=document.getElementById('assistant-cancel'),retry=document.getElementById('assistant-retry'),clear=document.getElementById('assistant-clear');let activeId=null,lastPrompt='';const setBusy=busy=>{send.disabled=busy;cancel.disabled=!busy;retry.disabled=busy||!lastPrompt};const makeId=()=>{if(globalThis.crypto&&crypto.randomUUID)return crypto.randomUUID();return 'assistant-'+Date.now()+'-'+Math.random().toString(36).slice(2)};const append=text=>{output.textContent+=text;output.scrollTop=output.scrollHeight};const ask=prompt=>{const question=(prompt||input.value).trim();if(!question||activeId)return;if(!prompt)input.value='';lastPrompt=question;activeId=makeId();append((output.textContent?'\\n\\n':'')+'You: '+question+'\\n\\nAssistant: ');status.textContent='Thinking…';setBusy(true);socket.emit('assistant-request',{requestId:activeId,roomId:ROOM_ID,prompt:question,files:{html:htmlEd.value.slice(0,12000),css:cssEd.value.slice(0,12000),js:jsEd.value.slice(0,12000)}})};send.onclick=()=>ask();cancel.onclick=()=>{if(activeId){status.textContent='Cancelling…';socket.emit('assistant-cancel',{requestId:activeId,roomId:ROOM_ID})}};retry.onclick=()=>ask(lastPrompt);clear.onclick=()=>{if(!activeId){output.textContent='';status.textContent='Ask for help with the current files.'}};input.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();ask()}});socket.on('assistant-chunk',payload=>{if(payload&&payload.requestId===activeId&&typeof payload.text==='string')append(payload.text)});socket.on('assistant-done',payload=>{if(payload&&payload.requestId===activeId){status.textContent=payload.cancelled?'Cancelled. You can ask again.':'Response complete.';activeId=null;setBusy(false)}});socket.on('assistant-error',payload=>{if(!payload||!payload.requestId||payload.requestId===activeId){status.textContent=payload&&payload.message?payload.message:'The coding assistant is unavailable.';activeId=null;setBusy(false)}});socket.on('connect_error',()=>{if(activeId){status.textContent='Secure connection failed.';activeId=null;setBusy(false)}})})();
</script>`;
  const rateLimitScript = `<script>
const getAssistantRateLimitCountdown=${getAssistantRateLimitCountdown.toString()};
(()=>{const status=document.getElementById('assistant-status'),send=document.getElementById('assistant-send'),retry=document.getElementById('assistant-retry');let timer=null;const countdown=payload=>{let remaining=getAssistantRateLimitCountdown(payload&&payload.retryAfter);clearInterval(timer);send.disabled=true;retry.disabled=true;const tick=()=>{status.textContent='Rate limited. Try again in '+remaining+'s.';if(remaining<=0){clearInterval(timer);send.disabled=false;retry.disabled=false;status.textContent='You can ask again now.'}remaining-=1};tick();timer=setInterval(tick,1000)};socket.on('assistant-error',payload=>{if(payload&&payload.errorCategory==='rate_limit')countdown(payload)})})();
</script>`;
  return buildSandboxHtml(args).replace(
    "</body></html>",
    `${panel}${rateLimitScript}</body></html>`,
  );
}
