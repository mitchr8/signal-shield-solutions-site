(function(){
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const topBar = document.getElementById("topBar");
  if(topBar){
    const syncTopBar = () => topBar.classList.toggle("scrolled", window.scrollY > 10);
    syncTopBar();
    window.addEventListener("scroll", syncTopBar, { passive: true });
  }

  const revealNodes = document.querySelectorAll(".reveal");
  if(revealNodes.length){
    if(prefersReducedMotion || !("IntersectionObserver" in window)){
      revealNodes.forEach((node) => node.classList.add("visible"));
    }else{
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if(entry.isIntersecting){
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
      revealNodes.forEach((node) => observer.observe(node));
    }
  }

  if(!prefersReducedMotion){
    document.querySelectorAll("[data-tilt]").forEach((panel) => {
      const resetTilt = () => {
        panel.style.setProperty("--tilt-x", "0deg");
        panel.style.setProperty("--tilt-y", "0deg");
        panel.style.setProperty("--glow-x", "50%");
        panel.style.setProperty("--glow-y", "46%");
      };

      resetTilt();

      panel.addEventListener("pointermove", (event) => {
        const rect = panel.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width;
        const py = (event.clientY - rect.top) / rect.height;
        const tiltX = ((px - 0.5) * 6).toFixed(2) + "deg";
        const tiltY = ((0.5 - py) * 6).toFixed(2) + "deg";
        panel.style.setProperty("--tilt-x", tiltX);
        panel.style.setProperty("--tilt-y", tiltY);
        panel.style.setProperty("--glow-x", (px * 100).toFixed(1) + "%");
        panel.style.setProperty("--glow-y", (py * 100).toFixed(1) + "%");
      });

      panel.addEventListener("pointerleave", resetTilt);
      panel.addEventListener("pointercancel", resetTilt);
    });
  }

  initFormShells();
  initChat();

  function isValidEmail(value){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function submitFormSubmit(payload){
    const response = await fetch("https://formsubmit.co/ajax/support@signalshieldsolutions.com", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body: payload.toString()
    });

    if(!response.ok){
      throw new Error("send failed");
    }

    return response.json().catch(() => ({}));
  }

  function prettifyFieldName(name){
    return String(name || "")
      .replace(/^_+/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (match) => match.toUpperCase());
  }

  function buildMailtoHref(subject, body){
    return "mailto:support@signalshieldsolutions.com?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  async function copyToClipboard(text){
    if(navigator.clipboard && typeof navigator.clipboard.writeText === "function"){
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  }

  function createFallbackBody(formData){
    const lines = [];
    for(const [key, value] of formData.entries()){
      if(String(key).startsWith("_")){
        continue;
      }
      if(value == null || String(value).trim() === ""){
        continue;
      }
      lines.push(prettifyFieldName(key) + ": " + String(value).trim());
    }
    return lines.join("\n");
  }

  function setFormResponse(responseNode, tone, content){
    responseNode.className = "form-response " + tone;
    responseNode.innerHTML = "";
    if(typeof content === "string"){
      responseNode.textContent = content;
    }else if(content){
      responseNode.appendChild(content);
    }
  }

  function initFormShells(){
    const forms = document.querySelectorAll(".form-shell[action*='formsubmit.co']");
    forms.forEach((form) => {
      if(form.dataset.ajaxBound === "true"){
        return;
      }
      form.dataset.ajaxBound = "true";

      const submitButton = form.querySelector("button[type='submit'], input[type='submit']");
      if(!submitButton){
        return;
      }

      let responseNode = form.querySelector("[data-form-response]");
      if(!responseNode){
        responseNode = document.createElement("div");
        responseNode.className = "form-response";
        responseNode.setAttribute("data-form-response", "");
        responseNode.setAttribute("aria-live", "polite");
        form.appendChild(responseNode);
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const payload = new URLSearchParams();

        for(const [key, value] of formData.entries()){
          if(typeof value === "string"){
            payload.append(key, value);
          }
        }

        if(payload.has("_captcha")){
          payload.set("_captcha", "false");
        }else{
          payload.append("_captcha", "false");
        }

        const emailValue = (formData.get("email") || "").toString().trim();
        if(emailValue && !payload.has("_replyto")){
          payload.append("_replyto", emailValue);
        }

        const subject = (formData.get("_subject") || "Website inquiry").toString().trim();
        const fallbackBody = createFallbackBody(formData);
        const originalLabel = submitButton.tagName === "INPUT" ? submitButton.value : submitButton.textContent;

        submitButton.disabled = true;
        if(submitButton.tagName === "INPUT"){
          submitButton.value = "Sending...";
        }else{
          submitButton.textContent = "Sending...";
        }
        setFormResponse(responseNode, "pending", "Sending your message now.");

        try{
          await submitFormSubmit(payload);
          form.reset();
          setFormResponse(responseNode, "success", "Thanks. Your message is on the way.");
        }catch(error){
          const wrapper = document.createElement("div");
          const message = document.createElement("p");
          message.textContent = "Automatic sending is unavailable right now. Use the fallback options below so the message is still ready to send.";
          wrapper.appendChild(message);

          const actions = document.createElement("div");
          actions.className = "form-fallback-actions";

          const emailButton = document.createElement("button");
          emailButton.type = "button";
          emailButton.className = "btn secondary mini-button";
          emailButton.textContent = "Open email draft";
          emailButton.addEventListener("click", () => {
            window.location.href = buildMailtoHref(subject, fallbackBody);
          });
          actions.appendChild(emailButton);

          const copyButton = document.createElement("button");
          copyButton.type = "button";
          copyButton.className = "btn secondary mini-button";
          copyButton.textContent = "Copy message";
          copyButton.addEventListener("click", async () => {
            const copied = await copyToClipboard("Subject: " + subject + "\n\n" + fallbackBody).catch(() => false);
            copyButton.textContent = copied ? "Copied" : "Copy failed";
          });
          actions.appendChild(copyButton);

          wrapper.appendChild(actions);
          setFormResponse(responseNode, "error", wrapper);
        }finally{
          submitButton.disabled = false;
          if(submitButton.tagName === "INPUT"){
            submitButton.value = originalLabel;
          }else{
            submitButton.textContent = originalLabel;
          }
        }
      });
    });
  }

  function initChat(){
    const chatBtn = document.getElementById("chatBtn");
    const chatPanel = document.getElementById("chatPanel");
    const chatClose = document.getElementById("chatClose");
    const chatMessages = document.getElementById("chatMessages");
    const chatChoices = document.getElementById("chatChoices");
    const chatForm = document.getElementById("chatForm");
    const chatInput = document.getElementById("chatInput");
    const chatSend = chatForm ? chatForm.querySelector("button") : null;

    if(!chatBtn || !chatPanel || !chatClose || !chatMessages || !chatChoices || !chatForm || !chatInput || !chatSend){
      return;
    }

    const config = window.CHAT_CONFIG || {};
    const state = {
      started: false,
      step: "service",
      sending: false,
      data: {
        page: config.page || document.title,
        url: window.location.href
      }
    };

    function addMessage(role, text){
      const bubble = document.createElement("div");
      bubble.className = "chat-bubble " + role;
      bubble.textContent = text;
      chatMessages.appendChild(bubble);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function setChoices(items){
      chatChoices.innerHTML = "";
      (items || []).forEach((item) => {
        const label = typeof item === "string" ? item : item.label;
        const value = typeof item === "string" ? item : item.value;
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chat-chip";
        chip.textContent = label;
        chip.addEventListener("click", () => handleInput(value, label));
        chatChoices.appendChild(chip);
      });
    }

    function setOpen(open){
      chatPanel.classList.toggle("open", open);
      chatPanel.setAttribute("aria-hidden", String(!open));
      chatBtn.setAttribute("aria-expanded", String(open));
      if(open){
        if(!state.started){
          startChat();
        }
        window.setTimeout(() => chatInput.focus(), 40);
      }
    }

    function startChat(){
      state.started = true;
      addMessage("bot", config.welcome || "Welcome.");
      addMessage("bot", config.prompt || "How can we help?");
      setChoices(config.choices || []);
      chatInput.placeholder = "Choose an option or type your answer";
    }

    function resetChat(){
      chatMessages.innerHTML = "";
      chatChoices.innerHTML = "";
      chatInput.disabled = false;
      chatSend.disabled = false;
      chatInput.value = "";
      state.started = false;
      state.step = "service";
      state.sending = false;
      state.data = {
        page: config.page || document.title,
        url: window.location.href
      };
      startChat();
    }

    async function submitLead(){
      state.sending = true;
      chatInput.disabled = true;
      chatSend.disabled = true;
      setChoices([]);
      addMessage("bot", "Sending this to our team now.");

      const payload = new URLSearchParams({
        name: state.data.name,
        email: state.data.email,
        _replyto: state.data.email,
        _subject: config.subject || "Website inquiry",
        _captcha: "false",
        service: state.data.service || "General",
        page: state.data.page,
        message:
          "Service: " + (state.data.service || "General") + "\n" +
          "Page: " + state.data.page + "\n" +
          "URL: " + state.data.url + "\n" +
          "Name: " + state.data.name + "\n" +
          "Email: " + state.data.email + "\n" +
          "Details: " + state.data.details
      });

      try{
        await submitFormSubmit(payload);
        addMessage("bot", "Thanks, " + state.data.name + ". Your message is on the way, and we will reply at " + state.data.email + ".");
        state.step = "done";
        setChoices([{ label: "Start a new chat", value: "__reset__" }]);
      }catch(error){
        addMessage("bot", "Automatic sending is unavailable right now. You can still use the email link below or try again later.");
        state.step = "confirm";
        chatInput.disabled = false;
        chatSend.disabled = false;
        setChoices([
          { label: "Try again", value: "__send__" },
          { label: "Start over", value: "__reset__" }
        ]);
      }finally{
        state.sending = false;
      }
    }

    function handleInput(rawValue, label){
      const value = (rawValue || "").trim();
      if(!value || state.sending){
        return;
      }

      if(value === "__reset__"){
        resetChat();
        return;
      }

      if(value === "__send__"){
        addMessage("user", label || "Send it");
        submitLead();
        return;
      }

      addMessage("user", label || value);

      if(state.step === "service"){
        state.data.service = value;
        state.step = "name";
        setChoices([]);
        chatInput.value = "";
        chatInput.placeholder = "Your name";
        addMessage("bot", "Got it. What should we call you?");
        return;
      }

      if(state.step === "name"){
        state.data.name = value;
        state.step = "email";
        chatInput.value = "";
        chatInput.placeholder = "name@example.com";
        addMessage("bot", "Thanks, " + value.split(" ")[0] + ". What email should we reply to?");
        return;
      }

      if(state.step === "email"){
        if(!isValidEmail(value)){
          chatInput.value = "";
          addMessage("bot", "Please enter a valid email address so we can reply.");
          return;
        }

        state.data.email = value;
        state.step = "details";
        chatInput.value = "";
        chatInput.placeholder = config.detailsPlaceholder || "Share the details";
        addMessage("bot", config.detailsPrompt || "Share a short summary so our team has the right context.");
        return;
      }

      if(state.step === "details"){
        state.data.details = value;
        state.step = "confirm";
        chatInput.value = "";
        chatInput.placeholder = "Add anything else or choose Send it";
        addMessage("bot", "I have what I need. Send this to the team?");
        setChoices([
          { label: "Send it", value: "__send__" },
          { label: "Start over", value: "__reset__" }
        ]);
        return;
      }

      if(state.step === "confirm"){
        state.data.details += "\nAdditional note: " + value;
        chatInput.value = "";
        addMessage("bot", "Added that. Send it when you are ready.");
        setChoices([
          { label: "Send it", value: "__send__" },
          { label: "Start over", value: "__reset__" }
        ]);
        return;
      }

      if(state.step === "done"){
        resetChat();
      }
    }

    chatBtn.addEventListener("click", () => setOpen(!chatPanel.classList.contains("open")));
    chatClose.addEventListener("click", () => setOpen(false));
    chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      handleInput(chatInput.value);
    });

    document.addEventListener("keydown", (event) => {
      if(event.key === "Escape"){
        setOpen(false);
      }
    });

    document.addEventListener("click", (event) => {
      if(!chatPanel.classList.contains("open")){
        return;
      }
      if(chatPanel.contains(event.target) || chatBtn.contains(event.target)){
        return;
      }
      setOpen(false);
    });
  }
})();


/* Mobile grouped-nav tap toggle */
(function(){
  var mq = window.matchMedia("(max-width:760px)");
  document.addEventListener("click", function(e){
    var trigger = e.target.closest(".nav .nav-trigger");
    if(trigger){
      if(mq.matches){
        var group = trigger.closest(".has-menu");
        var isOpen = group.classList.contains("open");
        var opened = document.querySelectorAll(".nav .has-menu.open");
        for(var i=0;i<opened.length;i++){ if(opened[i]!==group){ opened[i].classList.remove("open"); } }
        group.classList.toggle("open", !isOpen);
        e.preventDefault();
      }
      return;
    }
    if(!e.target.closest(".nav .has-menu")){
      var g = document.querySelectorAll(".nav .has-menu.open");
      for(var j=0;j<g.length;j++){ g[j].classList.remove("open"); }
    }
  });
})();


/* Veteran resources: benefit finder (search + need topics + eligibility filter) */
(function(){
  var grid = document.getElementById("filterGrid");
  if(!grid){ return; }
  var needGrid = document.getElementById("needGrid");
  var searchEl = document.getElementById("benefitSearch");
  var countEl = document.getElementById("filterCount");
  var clearBtn = document.getElementById("filterClear");
  var showAllBtn = document.getElementById("filterShowAll");
  var shareBtn = document.getElementById("filterShare");
  var emptyEl = document.getElementById("filterEmpty");
  var panel = document.querySelector(".filter-panel");
  var main = document.querySelector("main");

  // ---- Save to my list (stored only in this visitor's browser) -------------
  var SAVE_KEY = "ssVetSavedV1";
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';
  function loadSaved(){
    try { var v = JSON.parse(localStorage.getItem(SAVE_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch(e){ return []; }
  }
  function storeSaved(list){
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(list)); } catch(e){}
  }
  var saved = loadSaved();
  function liKey(li){
    var a = li.querySelector("a[href]");
    return a ? a.getAttribute("href").replace(/\/+$/, "").toLowerCase() : li.textContent.trim().toLowerCase();
  }
  function liName(li){
    var a = li.querySelector("a[href]");
    return (a ? a.textContent : li.textContent).trim();
  }
  function addSaveButton(li){
    if(li.querySelector(".save-btn")){ return; }
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "save-btn";
    btn.innerHTML = STAR;
    li.appendChild(btn);
  }
  function syncSaveButton(li){
    var btn = li.querySelector(".save-btn");
    if(!btn){ return; }
    var on = saved.indexOf(liKey(li)) !== -1;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", (on ? "Remove " : "Save ") + liName(li) + (on ? " from my list" : " to my list"));
    btn.title = on ? "Saved to your list (tap to remove)" : "Save to my list";
    li.classList.toggle("is-saved", on);
  }
  var allItemLis = document.querySelectorAll("main section.section-anchor .feature-list li");
  for(var sb=0; sb<allItemLis.length; sb++){ addSaveButton(allItemLis[sb]); }

  // ---- Index every benefit on the page -------------------------------------
  var items = [];
  var sectionNodes = document.querySelectorAll("main section.section-anchor");
  for(var s=0;s<sectionNodes.length;s++){
    var sec = sectionNodes[s];
    var eyebrow = sec.querySelector(".section-head .eyebrow");
    var secText = eyebrow ? eyebrow.textContent : "";
    var lis = sec.querySelectorAll(".feature-list li");
    for(var l=0;l<lis.length;l++){
      var li = lis[l];
      var card = li.closest(".service-cluster");
      var ctx = secText;
      if(card){
        var tag = card.querySelector(".cluster-tag");
        var h3 = card.querySelector("h3");
        ctx += " " + (tag ? tag.textContent : "") + " " + (h3 ? h3.textContent : "");
      }
      var link = li.querySelector("a[href]");
      items.push({
        li: li,
        section: sec.id,
        req: li.getAttribute("data-req") || "",
        key: link ? link.getAttribute("href").replace(/\/+$/, "").toLowerCase() : li.textContent.trim().toLowerCase(),
        text: norm(li.textContent),
        ctx: norm(ctx),
        html: li.innerHTML
      });
    }
  }
  var uniqueKeys = {};
  for(var u=0;u<items.length;u++){ uniqueKeys[items[u].key] = true; }
  var totalCount = Object.keys(uniqueKeys).length;

  // ---- Helpers ---------------------------------------------------------------
  function norm(str){
    return (" " + String(str || "") + " ")
      .toLowerCase()
      .replace(/[‘’']/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9%]+/g, " ");
  }
  function escRe(str){ return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // Everyday words people type -> words this page actually uses.
  var SYNONYMS = {
    "ptsd": ["mental health","counseling","peer support","vet center","trauma","crisis"],
    "depression": ["mental health","counseling","peer support","crisis"],
    "anxiety": ["mental health","counseling","peer support"],
    "suicide": ["crisis","mental health"],
    "therapy": ["counseling","mental health","therapist"],
    "therapist": ["counseling","mental health"],
    "counselor": ["counseling","mental health"],
    "tbi": ["brain injury","disability","wounded"],
    "school": ["education","gi bill","college","scholarship","tuition"],
    "college": ["education","gi bill","school","scholarship","tuition","fee waiver"],
    "tuition": ["education","gi bill","fee waiver","scholarship","yellow ribbon"],
    "university": ["education","gi bill","college","scholarship"],
    "scholarship": ["scholarship","education"],
    "training": ["education","vocational","skillbridge","vet tec","career"],
    "rent": ["rent","emergency","financial assistance","homeless","supportive services","utilities"],
    "house": ["housing","home"],
    "mortgage": ["home loan","housing"],
    "homeless": ["homeless","housing","hud vash","supportive services"],
    "shelter": ["homeless","housing","transitional"],
    "job": ["employment","career","hiring","work"],
    "jobs": ["employment","career","hiring","work"],
    "career": ["employment","career","hiring"],
    "resume": ["employment","career","hiring"],
    "business": ["business","sdvosb","vosb","franchise","entrepreneur"],
    "money": ["financial","grant","pension","compensation","emergency","cash"],
    "cash": ["financial","grant","emergency"],
    "bills": ["financial","emergency","grant","utilities"],
    "food": ["food","calfresh","groceries"],
    "groceries": ["food","calfresh","commissar"],
    "snap": ["calfresh","food"],
    "doctor": ["health care","medical","va health"],
    "medical": ["health","medical"],
    "healthcare": ["health care","medical"],
    "insurance": ["insurance","valife","champva","health care"],
    "teeth": ["dental"],
    "dentist": ["dental"],
    "glasses": ["vision","eye"],
    "taxes": ["tax"],
    "car": ["automobile","vehicle","dmv","transit"],
    "vehicle": ["automobile","vehicle","dmv"],
    "bus": ["transit","fare"],
    "license": ["dmv","license"],
    "dog": ["k9","service dog"],
    "wife": ["spouse","survivor","family","dependent"],
    "husband": ["spouse","survivor","family","dependent"],
    "widow": ["survivor","spouse","dependency"],
    "widower": ["survivor","spouse","dependency"],
    "kids": ["children","dependent","family","scholarship"],
    "children": ["children","dependent","family"],
    "funeral": ["burial","memorial"],
    "cemetery": ["burial","memorial"],
    "lawyer": ["legal"],
    "attorney": ["legal"],
    "claim": ["claim","disability","service officer","cvso"],
    "rating": ["disability","rating"],
    "dd214": ["dd 214","records"],
    "records": ["records","dd 214"],
    "travel": ["travel","space available","pass","vacation"],
    "vacation": ["vacation","travel","resort"],
    "park": ["park","pass"],
    "parks": ["park","pass"],
    "hunting": ["hunting","fishing","license"],
    "fishing": ["fishing","hunting","fly fishing"],
    "discount": ["discount","save","savings","free"],
    "deals": ["discount","savings"],
    "free": ["free","no cost","discount"],
    "tickets": ["tickets","vet tix"],
    "caregiver": ["caregiver","aid and attendance"],
    "elderly": ["long term care","elder","aid and attendance","pension","veterans homes"],
    "nursing": ["nursing home","veterans homes","aid and attendance","long term care"],
    "apple": ["high desert","apple valley"],
    "victorville": ["high desert","victor valley"],
    "hesperia": ["high desert"],
    "barstow": ["high desert","barstow"],
    "mileage": ["travel pay","mileage","van"],
    "ride": [" van","travel pay"," transit "],
    "rides": [" van","travel pay"," transit "],
    "transportation": [" van","travel pay"," transit ","fare"],
    "gas": ["travel pay","mileage"],
    "scam": ["fraud","scam","claim shark","accredited"],
    "scams": ["fraud","scam","claim shark","accredited"],
    "fraud": ["fraud","scam"],
    "shark": ["claim shark","accredited","fraud"],
    "oth": ["other than honorable","bad paper","discharge upgrade"],
    "discharge": ["discharge","dd 214"],
    "upgrade": ["discharge upgrade","upgrade"],
    "women": ["women"],
    "woman": ["women"],
    "female": ["women"],
    "mst": ["military sexual trauma","mst"],
    "senior": ["long term care","elder","aid and attendance","pension","veterans homes"],
    "seniors": ["long term care","elder","aid and attendance","pension","veterans homes"],
    "aging": ["long term care","elder","aid and attendance"],
    "respite": ["respite","caregiver"],
    "life": ["life insurance","vgli","valife"],
    "separating": ["pre discharge","first year","bdd","skillbridge"],
    "separation": ["pre discharge","first year","bdd","skillbridge"],
    "transition": ["pre discharge","first year","bdd","skillbridge","career"]
  };

  function stem(word){
    if(word.length > 4 && /ies$/.test(word)){ return word.slice(0,-3) + "y"; }
    if(word.length > 3 && /s$/.test(word) && !/ss$/.test(word)){ return word.slice(0,-1); }
    return word;
  }

  // Common filler words people type that shouldn't have to match anything.
  var STOP = {"a":1,"an":1,"the":1,"for":1,"to":1,"of":1,"and":1,"or":1,"in":1,"on":1,"my":1,"me":1,"i":1,"im":1,"with":1,"help":1,"need":1,"get":1,"how":1,"do":1,"what":1,"is":1,"are":1,"veteran":1,"veterans":1};

  function parseQuery(q){
    var raw = norm(q).trim();
    if(!raw){ return []; }
    // Join "dd 214" style typing so it still hits.
    raw = raw.replace(/\bdd 214\b/g, "dd214");
    var words = raw.split(" ");
    var groups = [];
    for(var i=0;i<words.length;i++){
      var w = words[i];
      if(!w || STOP[w]){ continue; }
      var alts = [w];
      var st = stem(w);
      if(st !== w){ alts.push(st); }
      var syn = SYNONYMS[w] || SYNONYMS[st];
      // Short abbreviations with a synonym entry ("oth", "mst") match only as whole words.
      if(syn && w.length <= 3){ alts = [" " + w + " "]; }
      if(syn){ alts = alts.concat(syn); }
      if(w === "dd214"){ alts = ["dd 214","dd214","records"]; }
      groups.push({ word: w, alts: alts });
    }
    // If every word was filler ("help for veterans"), fall back to the raw words.
    if(!groups.length){
      for(var j=0;j<words.length;j++){ if(words[j]){ groups.push({ word: words[j], alts: [words[j]] }); } }
    }
    return groups;
  }

  function hasAlt(hay, alt){
    // Match at the start of a word, so "ride" doesn't hit "provide".
    // Alternates wrapped in spaces (e.g. " oth ") must match a whole word.
    if(alt.charAt(0) === " "){ return hay.indexOf(alt) !== -1; }
    return hay.indexOf(" " + alt) !== -1;
  }

  // Search-match: every typed word (or one of its synonyms) must appear in
  // the benefit's own text or in the card/section it sits in.
  function searchMatches(item, groups){
    var hay = item.text + item.ctx;
    for(var g=0;g<groups.length;g++){
      var ok = false;
      for(var a=0;a<groups[g].alts.length;a++){
        if(hasAlt(hay, groups[g].alts[a])){ ok = true; break; }
      }
      if(!ok){ return false; }
    }
    return true;
  }

  // Eligibility. data-req = space-separated OR clauses, each a "+"-joined AND list.
  // Implied tags: a 100% rating is also "any rating"; High Desert residents are California residents.
  var IMPLIES = { "disability-100": ["disability-any"], "local": ["ca-resident"] };
  function expand(checked){
    var out = checked.slice();
    for(var i=0;i<checked.length;i++){
      var extra = IMPLIES[checked[i]] || [];
      for(var j=0;j<extra.length;j++){ if(out.indexOf(extra[j]) === -1){ out.push(extra[j]); } }
    }
    return out;
  }
  function reqMatches(req, have){
    var clauses = req.split(/\s+/);
    for(var c=0;c<clauses.length;c++){
      if(!clauses[c]){ continue; }
      var tags = clauses[c].split("+");
      var all = true;
      for(var t=0;t<tags.length;t++){ if(have.indexOf(tags[t]) === -1){ all = false; break; } }
      if(all){ return true; }
    }
    return false;
  }

  function checkedValues(container){
    var out = [];
    if(!container){ return out; }
    var boxes = container.querySelectorAll("input:checked");
    for(var i=0;i<boxes.length;i++){ out.push(boxes[i].value); }
    return out;
  }
  function needSections(){
    var out = [];
    if(!needGrid){ return out; }
    var boxes = needGrid.querySelectorAll("input:checked");
    for(var i=0;i<boxes.length;i++){
      out = out.concat((boxes[i].getAttribute("data-sections") || "").split(/\s+/));
    }
    return out;
  }

  // Wrap matched words in <mark>, touching text nodes only so links stay intact.
  function highlight(li, groups){
    var terms = [];
    for(var g=0;g<groups.length;g++){
      for(var a=0;a<groups[g].alts.length;a++){
        var t = groups[g].alts[a].trim();
        if(t.length >= 2 && terms.indexOf(t) === -1){ terms.push(t); }
      }
    }
    if(!terms.length){ return; }
    terms.sort(function(x,y){ return y.length - x.length; });
    var re = new RegExp("\\b(" + terms.map(escRe).join("|") + ")", "gi");
    var walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [];
    while(walker.nextNode()){
      var n = walker.currentNode;
      if(n.parentNode && n.parentNode.closest && n.parentNode.closest(".req-tag, .req-connector, .for-you-badge, .save-btn")){ continue; }
      nodes.push(n);
    }
    for(var i=0;i<nodes.length;i++){
      var node = nodes[i];
      var txt = node.nodeValue;
      re.lastIndex = 0;
      if(!re.test(txt)){ continue; }
      re.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var last = 0, m;
      while((m = re.exec(txt))){
        if(m.index > last){ frag.appendChild(document.createTextNode(txt.slice(last, m.index))); }
        var mark = document.createElement("mark");
        mark.className = "finder-mark";
        mark.textContent = m[0];
        frag.appendChild(mark);
        last = m.index + m[0].length;
        if(m[0].length === 0){ re.lastIndex++; }
      }
      if(last < txt.length){ frag.appendChild(document.createTextNode(txt.slice(last))); }
      node.parentNode.replaceChild(frag, node);
    }
  }

  // ---- State -----------------------------------------------------------------
  var showOpenToAll = false;

  function plural(n, one, many){ return n + " " + (n === 1 ? one : many); }

  function apply(fromUser, autoOpen){
    var openMode = showOpenToAll || !!autoOpen;
    var eligibility = checkedValues(grid);
    var have = expand(eligibility);
    var needs = needSections();
    var query = searchEl ? searchEl.value : "";
    var groups = parseQuery(query);
    var anyElig = eligibility.length > 0;
    var anyNeed = needs.length > 0;
    var anySearch = groups.length > 0;
    var active = anyElig || anyNeed || anySearch;

    var seen = {};
    var forYouCount = 0;
    var openCount = 0;
    var visibleCount = 0;

    for(var i=0;i<items.length;i++){
      var it = items[i];
      var li = it.li;
      // Reset any earlier highlighting / badges.
      if(li.getAttribute("data-finder-touched")){
        li.innerHTML = it.html;
        li.removeAttribute("data-finder-touched");
        syncSaveButton(li);
      }
      li.classList.remove("for-you");

      var show = true;
      var forYou = false;
      if(anyNeed && needs.indexOf(it.section) === -1){ show = false; }
      if(show && anySearch && !searchMatches(it, groups)){ show = false; }
      if(show && anyElig){
        if(it.req){
          if(reqMatches(it.req, have)){ forYou = true; } else { show = false; }
        } else if(!openMode){
          // Open-to-all benefit: counted, but tucked away until asked for.
          if(!seen[it.key]){ openCount++; }
          seen[it.key] = seen[it.key] || "open";
          show = false;
        }
      }
      // While searching/filtering, list each benefit once even if it's cross-listed.
      if(show && active){
        if(seen[it.key] === true){ show = false; }
        else { seen[it.key] = true; }
      }

      li.classList.toggle("filter-hide", !show);
      if(show){
        visibleCount++;
        if(forYou){ forYouCount++; }
        if(anyElig && !it.req && openMode){ openCount++; }
        if(forYou && anyElig){
          li.classList.add("for-you");
        }
        if(anySearch){
          highlight(li, groups);
          li.setAttribute("data-finder-touched", "1");
        }
      }
    }

    // Nothing limited to their exact situation? Show the open-to-all matches instead of a dead end.
    if(anyElig && !openMode && forYouCount === 0 && openCount > 0){ return apply(fromUser, true); }

    // Hide empty cards, sections, and cluster dividers.
    var articles = document.querySelectorAll("main .service-cluster");
    for(var a=0;a<articles.length;a++){
      var lisInCard = articles[a].querySelectorAll(".feature-list li");
      if(!lisInCard.length){ articles[a].classList.toggle("filter-hide", active); continue; }
      var vis = false;
      for(var k=0;k<lisInCard.length;k++){ if(!lisInCard[k].classList.contains("filter-hide")){ vis = true; break; } }
      articles[a].classList.toggle("filter-hide", !vis);
      if(vis && active){ articles[a].classList.add("visible"); }
    }
    for(var s2=0;s2<sectionNodes.length;s2++){
      var section = sectionNodes[s2];
      var cards = section.querySelectorAll(".service-cluster");
      if(!cards.length){ continue; }
      var secVis = false;
      for(var c=0;c<cards.length;c++){ if(!cards[c].classList.contains("filter-hide")){ secVis = true; break; } }
      section.classList.toggle("filter-hide", !secVis);
      if(secVis && active){
        var heads = section.querySelectorAll(".reveal");
        for(var h=0;h<heads.length;h++){ heads[h].classList.add("visible"); }
      }
    }
    if(main){
      var children = main.children;
      var currentDivider = null;
      var groupHasVisible = false;
      for(var n=0;n<children.length;n++){
        var node = children[n];
        if(node.classList && node.classList.contains("cluster-divider")){
          if(currentDivider){ currentDivider.classList.toggle("filter-hide", !groupHasVisible); }
          currentDivider = node;
          groupHasVisible = false;
        } else if(node.tagName === "SECTION" && node.classList.contains("section-anchor")){
          if(node.querySelectorAll(".service-cluster").length && !node.classList.contains("filter-hide")){ groupHasVisible = true; }
        }
      }
      if(currentDivider){ currentDivider.classList.toggle("filter-hide", !groupHasVisible); }
    }

    // Status line.
    if(countEl){
      var msg;
      if(!active){
        msg = "Showing all " + totalCount + " benefits. Search or pick what applies to you to narrow the list.";
      } else if(anyElig && autoOpen && !showOpenToAll){
        msg = "Nothing here is limited to your exact situation, so here " + (openCount === 1 ? "is 1 benefit" : "are " + openCount + " benefits") + " open to all veterans that match.";
      } else if(anyElig){
        msg = plural(forYouCount, "benefit is", "benefits are") + " specifically for your situation";
        if(openMode){ msg += ", plus " + plural(openCount, "benefit", "benefits") + " open to all veterans."; }
        else { msg += "."; }
      } else {
        msg = "Showing " + plural(visibleCount, "benefit", "benefits") + " that match" + (visibleCount === 1 ? "es" : "") + ".";
      }
      countEl.textContent = msg;
    }
    if(showAllBtn){
      var canShow = anyElig && !(autoOpen && !showOpenToAll) && (openCount > 0 || showOpenToAll);
      showAllBtn.hidden = !canShow;
      if(canShow){
        showAllBtn.textContent = showOpenToAll
          ? "Hide benefits open to all veterans"
          : "+ Show " + plural(openCount, "more benefit", "more benefits") + " open to all veterans";
        showAllBtn.setAttribute("aria-pressed", showOpenToAll ? "true" : "false");
      }
    }
    if(clearBtn){ clearBtn.hidden = !active; }
    if(shareBtn){ shareBtn.hidden = !active; }
    if(emptyEl){ emptyEl.hidden = !(active && visibleCount === 0 && !(anyElig && openCount > 0)); }
    if(panel){ panel.classList.toggle("is-active", active); }

    syncUrl(query, eligibility, needGrid ? checkedValues(needGrid) : []);
    updateDock(active, visibleCount);
  }

  // ---- Shareable URL ---------------------------------------------------------
  function syncUrl(query, eligibility, needs){
    if(!window.history || !history.replaceState){ return; }
    var params = [];
    if(query.trim()){ params.push("q=" + encodeURIComponent(query.trim())); }
    if(needs.length){ params.push("need=" + needs.join(",")); }
    if(eligibility.length){ params.push("for=" + eligibility.join(",")); }
    if(showOpenToAll && eligibility.length){ params.push("all=1"); }
    var url = location.pathname + (params.length ? "?" + params.join("&") : "") + location.hash;
    try { history.replaceState(null, "", url); } catch(e){}
  }
  function readUrl(){
    var qs = location.search.replace(/^\?/, "");
    if(!qs){ return; }
    var parts = qs.split("&");
    var map = {};
    for(var i=0;i<parts.length;i++){
      var kv = parts[i].split("=");
      try { map[decodeURIComponent(kv[0])] = decodeURIComponent((kv[1] || "").replace(/\+/g, " ")); } catch(e){}
    }
    if(map.q && searchEl){ searchEl.value = map.q; }
    function tick(container, list){
      if(!container || !list){ return; }
      var vals = list.split(",");
      var boxes = container.querySelectorAll("input[type=checkbox]");
      for(var b=0;b<boxes.length;b++){ if(vals.indexOf(boxes[b].value) !== -1){ boxes[b].checked = true; } }
    }
    tick(grid, map["for"]);
    tick(needGrid, map.need);
    if(map.all === "1"){ showOpenToAll = true; }
  }

  // ---- Sticky results dock (appears once the finder scrolls off-screen) -------
  var dock = document.createElement("div");
  dock.className = "finder-dock";
  dock.setAttribute("role", "region");
  dock.setAttribute("aria-label", "Search and filter results");
  dock.hidden = true;
  dock.innerHTML = '<span class="finder-dock-count"></span>' +
    '<button type="button" class="finder-dock-edit">Edit search</button>' +
    '<button type="button" class="finder-dock-clear">Clear</button>' +
    '<button type="button" class="finder-dock-list"></button>';
  document.body.appendChild(dock);
  var dockCount = dock.querySelector(".finder-dock-count");
  var dockList = dock.querySelector(".finder-dock-list");
  var panelOffscreen = false;
  var dockActive = false;
  var savedCount = 0;
  function refreshDock(){
    dock.hidden = !((dockActive || savedCount > 0) && panelOffscreen);
    dockCount.hidden = !dockActive;
    dock.querySelector(".finder-dock-edit").hidden = !dockActive;
    dock.querySelector(".finder-dock-clear").hidden = !dockActive;
    dockList.hidden = savedCount === 0;
  }
  function updateDock(active, visible){
    dockActive = active;
    if(dockCount){ dockCount.textContent = plural(visible, "result", "results"); }
    refreshDock();
  }
  if(panel && "IntersectionObserver" in window){
    new IntersectionObserver(function(entries){
      panelOffscreen = !entries[0].isIntersecting;
      refreshDock();
    }, { threshold: 0 }).observe(panel);
  }
  dock.querySelector(".finder-dock-edit").addEventListener("click", function(){
    if(panel){ panel.scrollIntoView({ behavior: "smooth", block: "start" }); }
    if(searchEl){ setTimeout(function(){ searchEl.focus({ preventScroll: true }); }, 350); }
  });
  dock.querySelector(".finder-dock-clear").addEventListener("click", function(){ clearAll(); });

  // ---- Wiring ----------------------------------------------------------------
  function clearAll(){
    var boxes = document.querySelectorAll("#filterGrid input:checked, #needGrid input:checked");
    for(var i=0;i<boxes.length;i++){ boxes[i].checked = false; }
    if(searchEl){ searchEl.value = ""; }
    showOpenToAll = false;
    apply(true);
    var et = document.getElementById("eligToggle");
    if(et && et.getAttribute("aria-expanded") === "true"){ et.click(); }
  }

  grid.addEventListener("change", function(){ apply(true); });
  if(needGrid){ needGrid.addEventListener("change", function(){ apply(true); }); }
  if(clearBtn){ clearBtn.addEventListener("click", clearAll); }
  if(showAllBtn){
    showAllBtn.addEventListener("click", function(){ showOpenToAll = !showOpenToAll; apply(true); });
  }
  if(shareBtn){
    shareBtn.addEventListener("click", function(){
      var url = location.href;
      var done = function(){
        var old = shareBtn.textContent;
        shareBtn.textContent = "Link copied";
        setTimeout(function(){ shareBtn.textContent = old; }, 1800);
      };
      if(navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)){
        navigator.share({ title: document.title, url: url }).catch(function(){});
      } else if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(url).then(done, function(){ window.prompt("Copy this link:", url); });
      } else {
        window.prompt("Copy this link:", url);
      }
    });
  }
  if(searchEl){
    var timer = null;
    searchEl.addEventListener("input", function(){
      clearTimeout(timer);
      timer = setTimeout(function(){ apply(true); }, 140);
    });
    searchEl.addEventListener("keydown", function(e){
      if(e.key === "Escape"){ searchEl.value = ""; apply(true); }
      if(e.key === "Enter"){
        e.preventDefault();
        var first = document.querySelector("main .feature-list li:not(.filter-hide)");
        if(first){ first.scrollIntoView({ behavior: "smooth", block: "center" }); }
      }
    });
    // "/" jumps to search from anywhere on the page.
    document.addEventListener("keydown", function(e){
      if(e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey){ return; }
      var t = e.target;
      if(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)){ return; }
      e.preventDefault();
      searchEl.focus();
    });
  }

  var eligToggle = document.getElementById("eligToggle");
  var eligWrap = document.getElementById("eligWrap");
  function setElig(open){
    if(!eligToggle || !eligWrap){ return; }
    eligWrap.classList.toggle("open", open);
    eligToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
  if(eligToggle){
    eligToggle.addEventListener("click", function(){
      setElig(eligToggle.getAttribute("aria-expanded") !== "true");
    });
  }

  var browseToggle = document.getElementById("browseToggle");
  var browseWrap = document.getElementById("browseWrap");
  if(browseToggle && browseWrap){
    browseToggle.addEventListener("click", function(){
      var open = browseToggle.getAttribute("aria-expanded") !== "true";
      browseWrap.classList.toggle("open", open);
      browseToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  readUrl();
  if(checkedValues(grid).length){ setElig(true); }
  apply(false);

  // Save-to-list wiring (needs `items`, so it lives after the index is built).
  for(var sv=0; sv<items.length; sv++){ syncSaveButton(items[sv].li); }
  var myListBtn = document.createElement("button");
  myListBtn.type = "button";
  myListBtn.className = "filter-clear my-list-btn";
  myListBtn.id = "myListBtn";
  var actionsRow = panel ? panel.querySelector(".filter-actions") : null;
  if(actionsRow){ actionsRow.insertBefore(myListBtn, actionsRow.firstChild); }

  var dialog = document.createElement("dialog");
  dialog.className = "my-list-dialog";
  dialog.setAttribute("aria-labelledby", "myListTitle");
  dialog.innerHTML =
    '<div class="my-list-head"><h2 id="myListTitle">My saved benefits</h2>' +
    '<button type="button" class="my-list-close" aria-label="Close">&times;</button></div>' +
    '<p class="my-list-note">Saved only in this browser on this device. Print it, send it to yourself, or bring it to your County Veterans Service Officer.</p>' +
    '<ol class="my-list-items"></ol>' +
    '<p class="my-list-empty">Nothing saved yet. Tap the star next to any benefit to add it here.</p>' +
    '<div class="my-list-actions">' +
    '<button type="button" class="btn primary my-list-print">Print</button>' +
    '<button type="button" class="btn secondary my-list-share">Share or copy</button>' +
    '<button type="button" class="btn secondary my-list-email">Email to myself</button>' +
    '<button type="button" class="filter-clear my-list-clear">Clear list</button>' +
    '</div>';
  document.body.appendChild(dialog);
  var listEl = dialog.querySelector(".my-list-items");
  var emptyNote = dialog.querySelector(".my-list-empty");

  function savedEntries(){
    var out = [], seenK = {};
    for(var i=0;i<items.length;i++){
      var k = items[i].key;
      if(saved.indexOf(k) === -1 || seenK[k]){ continue; }
      seenK[k] = true;
      var tmp = document.createElement("div");
      tmp.innerHTML = items[i].html;
      var tags = tmp.querySelectorAll(".req-tag, .req-connector, .save-btn");
      for(var t=0;t<tags.length;t++){ tags[t].parentNode.removeChild(tags[t]); }
      var a = tmp.querySelector("a[href]");
      var name = a ? a.textContent.trim() : "";
      var desc = tmp.textContent.replace(/\s+/g, " ").trim();
      if(name && desc.indexOf(name) === 0){ desc = desc.slice(name.length).replace(/^\s*[—-]\s*/, ""); }
      out.push({ name: name || desc.slice(0, 60), url: a ? a.href : "", desc: desc });
    }
    return out;
  }
  function esc(str){ return String(str).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }
  function renderList(){
    var entries = savedEntries();
    listEl.innerHTML = entries.map(function(e){
      return '<li><a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">' + esc(e.name) + '</a><span>' + esc(e.desc) + '</span></li>';
    }).join("");
    emptyNote.hidden = entries.length > 0;
    var acts = dialog.querySelector(".my-list-actions");
    acts.hidden = entries.length === 0;
    myListBtn.textContent = "My list (" + entries.length + ")";
    myListBtn.hidden = entries.length === 0;
    dockList.textContent = "My list (" + entries.length + ")";
    savedCount = entries.length;
    refreshDock();
    return entries;
  }
  function listText(entries){
    var lines = ["My veteran benefits list", "From https://signalshieldsolutions.com/veteran-resources", ""];
    entries.forEach(function(e, i){ lines.push((i+1) + ". " + e.name + (e.url ? " - " + e.url : "")); });
    lines.push("", "Veterans Crisis Line: call 988 and press 1, or text 838255.");
    return lines.join("\n");
  }
  function openList(){
    renderList();
    if(typeof dialog.showModal === "function"){ dialog.showModal(); } else { dialog.setAttribute("open", ""); }
  }
  function closeList(){
    if(typeof dialog.close === "function" && dialog.open){ dialog.close(); } else { dialog.removeAttribute("open"); }
  }
  myListBtn.addEventListener("click", openList);
  dockList.addEventListener("click", openList);
  dialog.querySelector(".my-list-close").addEventListener("click", closeList);
  dialog.addEventListener("click", function(e){ if(e.target === dialog){ closeList(); } });
  dialog.querySelector(".my-list-clear").addEventListener("click", function(){
    saved = []; storeSaved(saved);
    for(var i=0;i<items.length;i++){ syncSaveButton(items[i].li); }
    renderList();
  });
  dialog.querySelector(".my-list-print").addEventListener("click", function(){
    var entries = savedEntries();
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>My veteran benefits list</title>' +
      '<style>body{font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#111;margin:32px;max-width:720px}h1{font-size:22px;margin:0 0 4px}' +
      'p.src{color:#555;margin:0 0 20px}li{margin:0 0 14px}li b{display:block}li span{display:block;color:#333}li i{display:block;color:#555;font-style:normal;font-size:13px;word-break:break-all}' +
      '.crisis{margin-top:24px;padding:10px 12px;border:1px solid #999;border-radius:8px}</style></head><body>' +
      '<h1>My veteran benefits list</h1><p class="src">From signalshieldsolutions.com/veteran-resources &middot; printed ' + esc(new Date().toLocaleDateString()) + '</p><ol>' +
      entries.map(function(e){ return '<li><b>' + esc(e.name) + '</b><span>' + esc(e.desc) + '</span><i>' + esc(e.url) + '</i></li>'; }).join("") +
      '</ol><p class="crisis"><b>Veterans Crisis Line:</b> call 988 and press 1, or text 838255. Free and confidential, 24/7.</p>' +
      '<p class="src">Free County Veterans Service Officer help (San Bernardino County): 760-995-8010 (Hesperia) or 866-472-8387.</p></body></html>';
    var w = null;
    try { w = window.open("", "_blank"); } catch(e){}
    if(w){
      w.document.open(); w.document.write(html); w.document.close();
      w.focus();
      setTimeout(function(){ try { w.print(); } catch(e){} }, 300);
    } else {
      window.print();
    }
  });
  dialog.querySelector(".my-list-share").addEventListener("click", function(){
    var btn = this;
    var text = listText(savedEntries());
    var done = function(){ var o = btn.textContent; btn.textContent = "Copied"; setTimeout(function(){ btn.textContent = o; }, 1800); };
    if(navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)){
      navigator.share({ title: "My veteran benefits list", text: text }).catch(function(){});
    } else if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done, function(){ window.prompt("Copy your list:", text); });
    } else {
      window.prompt("Copy your list:", text);
    }
  });
  dialog.querySelector(".my-list-email").addEventListener("click", function(){
    location.href = "mailto:?subject=" + encodeURIComponent("My veteran benefits list") + "&body=" + encodeURIComponent(listText(savedEntries()));
  });
  document.addEventListener("click", function(e){
    var btn = e.target.closest ? e.target.closest(".save-btn") : null;
    if(!btn){ return; }
    var li = btn.closest("li");
    var k = liKey(li);
    var idx = saved.indexOf(k);
    if(idx === -1){ saved.push(k); } else { saved.splice(idx, 1); }
    storeSaved(saved);
    // Same benefit listed in two sections: keep both stars in sync.
    for(var i=0;i<items.length;i++){ if(items[i].key === k){ syncSaveButton(items[i].li); } }
    renderList();
  });
  // Another tab changed the list.
  window.addEventListener("storage", function(e){
    if(e.key !== SAVE_KEY){ return; }
    saved = loadSaved();
    for(var i=0;i<items.length;i++){ syncSaveButton(items[i].li); }
    renderList();
  });
  renderList();
})();
