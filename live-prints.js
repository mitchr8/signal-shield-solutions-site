(function(){
  const streamStatus = document.getElementById("streamStatus");
  const streamStatusLabel = document.getElementById("streamStatusLabel");
  const streamNote = document.getElementById("streamNote");
  const streamMount = document.getElementById("streamMount");
  const fullscreenBtn = document.getElementById("streamFullscreen");
  const streamCard = streamMount ? streamMount.closest(".stream-card") : null;
  const defaultOfflineTitle = document.getElementById("streamOfflineTitle");
  const defaultOfflineText = document.getElementById("streamOfflineText");

  const currentPrintImage = document.getElementById("currentPrintImage");
  const currentPrintPlaceholder = document.getElementById("currentPrintPlaceholder");
  const currentPrintEyebrow = document.querySelector(".current-print-eyebrow");
  const currentPrintTitle = document.getElementById("currentPrintTitle");
  const currentPrintSummary = document.getElementById("currentPrintSummary");
  const currentPrintState = document.getElementById("currentPrintState");
  const currentPrintProgress = document.getElementById("currentPrintProgress");
  const currentPrintObjectCount = document.getElementById("currentPrintObjectCount");
  const currentPrintObjects = document.getElementById("currentPrintObjects");
  const currentPrintInquiry = document.getElementById("currentPrintInquiry");
  const currentPrintShopLink = document.getElementById("currentPrintShopLink");

  const productMarquee = document.getElementById("productMarquee");
  const productTrack = document.getElementById("productTrack");
  const productEmpty = document.getElementById("productEmpty");

  const liveForm = document.getElementById("livePrintForm");
  const liveType = document.getElementById("live-type");
  const liveTiming = document.getElementById("live-timing");
  const liveMessage = document.getElementById("live-message");
  const contactSelection = document.getElementById("contactSelection");

  if(
    !streamStatus || !streamStatusLabel || !streamNote || !streamMount || !fullscreenBtn ||
    !streamCard || !defaultOfflineTitle || !defaultOfflineText
  ){
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const streamConfig = window.STREAM_CONFIG || {};
  const pageConfig = window.LIVE_PRINTS_CONFIG || {};
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let cloudflareLiveState = null;
  let cloudflarePlayerMounted = false;
  let cloudflareAttachInFlight = false;
  let cloudflareWhepSession = null;
  let lifecyclePollTimer = null;
  let lifecyclePollInFlight = false;
  let playbackWatchdogTimer = null;
  let currentPrintData = null;
  let productIndex = new Map();

  function withCacheBust(url){
    const nextUrl = new URL(url, window.location.href);
    nextUrl.searchParams.set("ts", String(Date.now()));
    return nextUrl.toString();
  }

  function resolveCurrentPrintImageUrl(imagePath, imageVersion){
    if(!imagePath){
      return "";
    }

    const baseUrl = pageConfig.currentPrintImageBaseUrl || window.location.origin;
    const resolved = new URL(imagePath, baseUrl);
    if(imageVersion){
      resolved.searchParams.set("v", imageVersion);
    }
    return resolved.toString();
  }

  if(currentPrintImage && currentPrintPlaceholder){
    currentPrintImage.addEventListener("load", function(){
      currentPrintImage.hidden = false;
      currentPrintPlaceholder.hidden = true;
    });

    currentPrintImage.addEventListener("error", function(){
      currentPrintImage.hidden = true;
      currentPrintImage.removeAttribute("src");
      currentPrintPlaceholder.hidden = false;
    });
  }

  function escapeHtml(value){
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setStatus(label, noteText, live){
    streamStatus.classList.toggle("live", Boolean(live));
    streamStatusLabel.textContent = label;
    streamNote.textContent = noteText;
  }

  function getFullscreenElement(){
    return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
  }

  function syncFullscreenButton(){
    const active = Boolean(getFullscreenElement());
    fullscreenBtn.textContent = active ? "Exit full screen" : "Full screen";
  }

  async function toggleFullscreen(){
    try{
      if(getFullscreenElement()){
        if(typeof document.exitFullscreen === "function"){
          await document.exitFullscreen();
        }else if(typeof document.webkitExitFullscreen === "function"){
          document.webkitExitFullscreen();
        }else if(typeof document.msExitFullscreen === "function"){
          document.msExitFullscreen();
        }
      }else{
        if(typeof streamCard.requestFullscreen === "function"){
          await streamCard.requestFullscreen();
        }else if(typeof streamCard.webkitRequestFullscreen === "function"){
          streamCard.webkitRequestFullscreen();
        }else if(typeof streamCard.msRequestFullscreen === "function"){
          streamCard.msRequestFullscreen();
        }
      }
    }catch(error){
      console.error("Fullscreen toggle failed", error);
    }
  }

  function clearStreamAction(){
    const existing = streamMount.querySelector(".stream-action");
    if(existing){
      existing.remove();
    }
  }

  function clearPlaybackWatchdog(){
    if(playbackWatchdogTimer){
      window.clearTimeout(playbackWatchdogTimer);
      playbackWatchdogTimer = null;
    }
  }

  function showStreamAction(label, handler){
    clearStreamAction();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stream-action";
    button.textContent = label;
    button.addEventListener("click", function(event){
      event.preventDefault();
      handler();
    });
    streamMount.appendChild(button);
  }

  function renderPlaceholder(title, text){
    cloudflarePlayerMounted = false;
    cloudflareAttachInFlight = false;
    streamMount.innerHTML = '<div class="stream-placeholder"><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(text) + '</p></div>';
  }

  function teardownCloudflarePlayer(){
    clearStreamAction();
    clearPlaybackWatchdog();
    closeCloudflareWhepSession();
    cloudflarePlayerMounted = false;
    cloudflareAttachInFlight = false;
    streamMount.innerHTML = "";
  }

  function buildFrame(source){
    const frame = document.createElement("iframe");
    const frameUrl = new URL(source.url);
    frame.src = frameUrl.toString();
    frame.title = source.label;
    frame.loading = "lazy";
    frame.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
    frame.allowFullscreen = true;
    return frame;
  }

  function parseIceServers(linkHeader){
    if(!linkHeader){
      return [];
    }

    return linkHeader
      .split(",")
      .map(function(part){
        return part.trim();
      })
      .map(function(part){
        const match = part.match(/<([^>]+)>;\s*rel="ice-server"/i);
        return match ? match[1] : "";
      })
      .filter(Boolean)
      .map(function(url){
        return { urls: url };
      });
  }

  function waitForIceGatheringComplete(peerConnection){
    if(peerConnection.iceGatheringState === "complete"){
      return Promise.resolve();
    }

    return new Promise(function(resolve){
      function handleChange(){
        if(peerConnection.iceGatheringState === "complete"){
          peerConnection.removeEventListener("icegatheringstatechange", handleChange);
          resolve();
        }
      }

      peerConnection.addEventListener("icegatheringstatechange", handleChange);
    });
  }

  function closeCloudflareWhepSession(){
    const session = cloudflareWhepSession;
    cloudflareWhepSession = null;

    if(!session){
      return;
    }

    if(session.peerConnection){
      try{
        session.peerConnection.ontrack = null;
        session.peerConnection.onconnectionstatechange = null;
        session.peerConnection.oniceconnectionstatechange = null;
        session.peerConnection.close();
      }catch(error){
        console.error("Cloudflare WHEP close failed", error);
      }
    }

    if(session.resourceUrl){
      fetch(session.resourceUrl, {
        method: "DELETE",
        mode: "cors",
        credentials: "omit"
      }).catch(function(){
      });
    }
  }

  function markCloudflarePlaybackHealthy(){
    clearPlaybackWatchdog();
    clearStreamAction();
    cloudflarePlayerMounted = true;
  }

  function requestVideoPlayback(video, showManualAction){
    if(!video){
      return;
    }

    let playPromise;
    try{
      playPromise = video.play();
    }catch(error){
      console.error("Cloudflare video.play() threw", error);
      if(showManualAction){
        showStreamAction("Start stream", function(){
          requestVideoPlayback(video, false);
        });
      }
      return;
    }

    if(playPromise && typeof playPromise.catch === "function"){
      playPromise.catch(function(error){
        console.error("Cloudflare video.play() failed", error);
        if(showManualAction){
          showStreamAction("Start stream", function(){
            requestVideoPlayback(video, false);
          });
        }
      });
    }
  }

  async function attachCloudflarePlayer(source){
    try{
      await (async function(){
        if(cloudflarePlayerMounted || cloudflareAttachInFlight){
          return;
        }

        cloudflareAttachInFlight = true;
        teardownCloudflarePlayer();

        const video = document.createElement("video");
        video.autoplay = true;
        video.controls = true;
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.setAttribute("muted", "");
        if(currentPrintData && currentPrintData.image){
          video.poster = resolveCurrentPrintImageUrl(currentPrintData.image, currentPrintData.imageVersion);
        }

        streamMount.innerHTML = "";
        streamMount.appendChild(video);

        const optionsResponse = await fetch(source.playUrl, {
          method: "OPTIONS",
          mode: "cors",
          credentials: "omit",
          cache: "no-store"
        });

        if(!optionsResponse.ok && optionsResponse.status !== 204){
          throw new Error("Cloudflare WHEP OPTIONS failed with status " + optionsResponse.status);
        }

        const peerConnection = new RTCPeerConnection({
          iceServers: parseIceServers(optionsResponse.headers.get("link"))
        });
        const remoteStream = new MediaStream();
        video.srcObject = remoteStream;
        video.addEventListener("loadedmetadata", function(){
          requestVideoPlayback(video, true);
        });
        video.addEventListener("canplay", function(){
          requestVideoPlayback(video, true);
        });
        video.addEventListener("playing", function(){
          markCloudflarePlaybackHealthy();
        });
        video.addEventListener("loadeddata", function(){
          if(remoteStream.getTracks().length){
            markCloudflarePlaybackHealthy();
          }
        });

        peerConnection.addTransceiver("video", { direction: "recvonly" });
        peerConnection.addTransceiver("audio", { direction: "recvonly" });

        peerConnection.addEventListener("track", function(event){
          remoteStream.addTrack(event.track);
          requestVideoPlayback(video, true);
        });

        peerConnection.addEventListener("connectionstatechange", function(){
          if(peerConnection.connectionState === "failed" || peerConnection.connectionState === "disconnected" || peerConnection.connectionState === "closed"){
            cloudflarePlayerMounted = false;
          }
        });

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await waitForIceGatheringComplete(peerConnection);

        const postResponse = await fetch(source.playUrl, {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          headers: {
            "Content-Type": "application/sdp"
          },
          body: peerConnection.localDescription.sdp
        });

        if(!postResponse.ok){
          throw new Error("Cloudflare WHEP POST failed with status " + postResponse.status);
        }

        const answerSdp = await postResponse.text();
        await peerConnection.setRemoteDescription({
          type: "answer",
          sdp: answerSdp
        });

        const resourceLocation = postResponse.headers.get("location");
        cloudflareWhepSession = {
          peerConnection: peerConnection,
          resourceUrl: resourceLocation ? new URL(resourceLocation, source.playUrl).toString() : ""
        };
        cloudflareAttachInFlight = false;
        requestVideoPlayback(video, true);
        clearPlaybackWatchdog();
        playbackWatchdogTimer = window.setTimeout(function(){
          const hasTracks = remoteStream.getTracks().length > 0;
          const ready = video.readyState >= 2;
          const playing = !video.paused;
          if(ready || playing){
            markCloudflarePlaybackHealthy();
            return;
          }

          console.error("Cloudflare WHEP playback stalled before media became playable.");
          teardownCloudflarePlayer();
          renderPlaceholder(
            "Live print is starting.",
            "The camera is online, but playback is still catching up. Retrying automatically."
          );
          scheduleLifecyclePoll(source, hasTracks ? 3000 : 5000);
        }, 12000);
      })();
    }catch(error){
      cloudflareAttachInFlight = false;
      throw error;
    }
  }

  function pickValue(paramName, configName){
    return (params.get(paramName) || streamConfig[configName] || "").trim();
  }

  function resolveSource(){
    const cloudflareCustomerCode = pickValue("cloudflare_code", "cloudflareCustomerCode");
    const cloudflareLiveInputId = pickValue("cloudflare_input", "cloudflareLiveInputId");
    if(cloudflareCustomerCode && cloudflareLiveInputId){
      return {
        kind: "cloudflare",
        code: cloudflareCustomerCode,
        inputId: cloudflareLiveInputId,
        playUrl: "https://customer-" + encodeURIComponent(cloudflareCustomerCode) + ".cloudflarestream.com/" + encodeURIComponent(cloudflareLiveInputId) + "/webRTC/play",
        label: "Cloudflare Stream live input"
      };
    }

    const iframeUrl = pickValue("iframe", "iframeUrl");
    if(iframeUrl){
      return {
        kind: "iframe",
        url: iframeUrl,
        label: "Custom live source"
      };
    }

    const youtubeVideoId = pickValue("youtube", "youtubeVideoId");
    if(youtubeVideoId){
      return {
        kind: "youtube-video",
        url: "https://www.youtube.com/embed/" + encodeURIComponent(youtubeVideoId) + "?autoplay=1&rel=0&modestbranding=1",
        label: "YouTube live feed"
      };
    }

    const youtubeChannelId = pickValue("youtube_channel", "youtubeChannelId");
    if(youtubeChannelId){
      return {
        kind: "youtube-channel",
        url: "https://www.youtube.com/embed/live_stream?channel=" + encodeURIComponent(youtubeChannelId) + "&autoplay=1",
        label: "YouTube channel live feed"
      };
    }

    const twitchChannel = pickValue("twitch", "twitchChannel");
    if(twitchChannel){
      const parent = window.location.hostname || "signalshieldsolutions.com";
      return {
        kind: "twitch",
        url: "https://player.twitch.tv/?channel=" + encodeURIComponent(twitchChannel) + "&parent=" + encodeURIComponent(parent) + "&autoplay=true",
        label: "Twitch live feed"
      };
    }

    return null;
  }

  function buildCloudflareProxyUrl(source, suffix){
    return "/live-stream/" + encodeURIComponent(source.inputId) + "/" + suffix;
  }

  function clearLifecyclePollTimer(){
    if(lifecyclePollTimer){
      window.clearTimeout(lifecyclePollTimer);
      lifecyclePollTimer = null;
    }
  }

  function getLifecyclePollDelay(){
    if(document.hidden){
      return 180000;
    }

    if(cloudflareLiveState === true){
      return 30000;
    }

    if(cloudflareLiveState === false){
      return 60000;
    }

    return 45000;
  }

  function scheduleLifecyclePoll(source, delay){
    clearLifecyclePollTimer();
    lifecyclePollTimer = window.setTimeout(function(){
      syncCloudflareLifecycle(source);
    }, typeof delay === "number" ? delay : getLifecyclePollDelay());
  }

  async function syncCloudflareLifecycle(source, options){
    if(lifecyclePollInFlight){
      return;
    }

    lifecyclePollInFlight = true;
    const lifecycleUrl = buildCloudflareProxyUrl(source, "lifecycle");

    try{
      const response = await fetch(lifecycleUrl, { cache: "no-store" });
      if(!response.ok){
        throw new Error("Lifecycle request failed");
      }

      const data = await response.json();
      if(data && data.live){
        if(cloudflareLiveState !== true || !cloudflarePlayerMounted){
          attachCloudflarePlayer(source).catch(function(error){
            console.error("Cloudflare WHEP attach failed", error);
            closeCloudflareWhepSession();
            cloudflarePlayerMounted = false;
            renderPlaceholder(
              "Live print is starting.",
              "The camera is online, but the browser is still establishing the stream. It should appear automatically."
            );
          });
        }
        cloudflareLiveState = true;
        setStatus("Live now", "An active print is currently broadcasting from the shop printer.", true);
      }else{
        if(cloudflareLiveState !== false){
          teardownCloudflarePlayer();
          renderPlaceholder(
            "No active print is broadcasting right now.",
            "Check back when the next live print starts."
          );
        }
        cloudflareLiveState = false;
        setStatus("Offline", "The live camera is offline right now. Check back during the next active print.", false);
      }
      scheduleLifecyclePoll(source);
    }catch(error){
      teardownCloudflarePlayer();
      renderPlaceholder(defaultOfflineTitle.textContent, defaultOfflineText.textContent);
      setStatus("Checking status", "The camera status is updating. Reload the page if this does not clear in a moment.", false);
      scheduleLifecyclePoll(source, document.hidden ? 180000 : 90000);
    }finally{
      lifecyclePollInFlight = false;
    }
  }

  function cleanObjectName(value){
    return String(value || "")
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[_+]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeCompareText(value){
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getCompareTokens(value){
    const stopWords = new Set(["the", "and", "for", "with", "new", "official", "version", "print", "parts", "set"]);
    return normalizeCompareText(value)
      .split(" ")
      .filter(function(token){
        return token && !stopWords.has(token);
      });
  }

  function findMatchingProductForCurrentPrint(data){
    if(!data || !data.title || !productIndex.size){
      return null;
    }

    const currentText = normalizeCompareText(data.title);
    const currentTokens = new Set(getCompareTokens(data.title));
    let bestItem = null;
    let bestScore = 0;

    productIndex.forEach(function(item){
      const itemText = normalizeCompareText(item.title);
      const itemTokens = getCompareTokens(item.title);
      let score = 0;

      if(currentText === itemText){
        score = 100;
      }else{
        if(currentText.includes(itemText) || itemText.includes(currentText)){
          score += 50;
        }

        itemTokens.forEach(function(token){
          if(currentTokens.has(token)){
            score += 10;
          }
        });
      }

      if(score > bestScore && score >= 20){
        bestScore = score;
        bestItem = item;
      }
    });

    return bestItem;
  }

  function setCurrentPrintInquiry(payload){
    if(!currentPrintInquiry){
      return;
    }

    currentPrintInquiry.dataset.title = payload && payload.title ? payload.title : "";
    currentPrintInquiry.dataset.price = payload && payload.priceLabel ? payload.priceLabel : "";
    currentPrintInquiry.dataset.message = payload && payload.message ? payload.message : "";
  }

  function setCurrentPrintShop(payload){
    if(!currentPrintShopLink){
      return;
    }

    const etsyUrl = payload && payload.etsyUrl ? payload.etsyUrl : "";
    if(etsyUrl){
      currentPrintShopLink.href = etsyUrl;
      currentPrintShopLink.hidden = false;
    }else{
      currentPrintShopLink.hidden = true;
      currentPrintShopLink.removeAttribute("href");
    }
  }

  function renderCurrentPrint(data){
    currentPrintData = data || null;

    if(!currentPrintTitle || !currentPrintSummary || !currentPrintState || !currentPrintProgress || !currentPrintObjectCount){
      return;
    }

    if(!data || !data.title){
      if(currentPrintEyebrow){
        currentPrintEyebrow.textContent = "Bambu preview";
      }
      currentPrintTitle.textContent = "Current print preview";
      currentPrintSummary.textContent = "The page will add the current print thumbnail and title here when local metadata is available.";
      currentPrintState.textContent = "Waiting";
      currentPrintProgress.textContent = "--";
      currentPrintObjectCount.textContent = "--";
      currentPrintObjects.hidden = true;
      currentPrintObjects.innerHTML = "";
      currentPrintImage.hidden = true;
      currentPrintImage.removeAttribute("src");
      currentPrintPlaceholder.hidden = false;
      setCurrentPrintInquiry(null);
      setCurrentPrintShop(null);
      return;
    }

    if(currentPrintEyebrow){
      currentPrintEyebrow.textContent = data.active ? "Active Bambu print" : "Latest Bambu load";
    }
    currentPrintTitle.textContent = data.title;
    const matchedProduct = !data.image ? findMatchingProductForCurrentPrint(data) : null;
    const updatedAtMs = data.updatedAt ? Date.parse(data.updatedAt) : NaN;
    const progressIsFresh = Number.isFinite(updatedAtMs) ? (Date.now() - updatedAtMs) < 45000 : false;
    currentPrintSummary.textContent = data.note || "This preview comes from the latest Bambu Studio project metadata available on the shop machine.";
    currentPrintState.textContent = data.gcodeState || (data.active ? "RUNNING" : "OFFLINE");
    if(typeof data.progress === "number" && (!data.active || progressIsFresh)){
      currentPrintProgress.textContent = data.progress + "%";
    }else if(data.active){
      currentPrintProgress.textContent = "Updating";
      if(!data.note){
        currentPrintSummary.textContent = "The live stream is online. Progress is still updating from the printer.";
      }
    }else{
      currentPrintProgress.textContent = "--";
    }

    const objectNames = Array.isArray(data.objects) ? data.objects.map(cleanObjectName).filter(Boolean) : [];
    currentPrintObjectCount.textContent = data.objectCount || (objectNames.length ? String(objectNames.length) : "--");

    if(objectNames.length){
      currentPrintObjects.hidden = false;
      currentPrintObjects.innerHTML = objectNames.slice(0, 6).map(function(name){
        return '<span>' + escapeHtml(name) + '</span>';
      }).join("");
    }else{
      currentPrintObjects.hidden = true;
      currentPrintObjects.innerHTML = "";
    }

    if(data.image){
      currentPrintImage.src = resolveCurrentPrintImageUrl(data.image, data.imageVersion);
      currentPrintImage.alt = data.title;
      currentPrintImage.hidden = false;
      currentPrintPlaceholder.hidden = true;
    }else if(matchedProduct && matchedProduct.image){
      const version = matchedProduct.imageVersion ? ("?v=" + encodeURIComponent(matchedProduct.imageVersion)) : "";
      currentPrintImage.src = matchedProduct.image + version;
      currentPrintImage.alt = matchedProduct.title || data.title;
      currentPrintImage.hidden = false;
      currentPrintPlaceholder.hidden = true;
      currentPrintSummary.textContent = "Live plate thumbnail is not available for this job yet. Showing the closest matching catalog preview instead.";
    }else{
      currentPrintImage.hidden = true;
      currentPrintImage.removeAttribute("src");
      currentPrintPlaceholder.hidden = false;
    }

    setCurrentPrintInquiry({
      title: data.title,
      priceLabel: matchedProduct && matchedProduct.priceLabel ? matchedProduct.priceLabel : "",
      message:
        "I am interested in the current print: " + data.title + ". " +
        (objectNames.length ? "Objects: " + objectNames.slice(0, 4).join(", ") + ". " : "") +
        "Please tell me the price, available material options, and next steps."
    });
    setCurrentPrintShop({
      etsyUrl: matchedProduct && matchedProduct.etsyUrl ? matchedProduct.etsyUrl : ""
    });
  }

  async function loadCurrentPrint(){
    const sources = [pageConfig.currentPrintUrl, pageConfig.currentPrintFallbackUrl].filter(Boolean);
    if(!sources.length){
      return;
    }

    for(const sourceUrl of sources){
      try{
        const response = await fetch(withCacheBust(sourceUrl), { cache: "no-store" });
        if(!response.ok){
          throw new Error("Current print request failed");
        }
        const data = await response.json();
        renderCurrentPrint(data);
        return;
      }catch(error){
      }
    }

    renderCurrentPrint(null);
  }

  function buildProductCard(item, duplicate){
    const article = document.createElement("article");
    article.className = "product-card";
    if(duplicate){
      article.setAttribute("aria-hidden", "true");
    }
    const imageVersion = item.imageVersion ? ("?v=" + encodeURIComponent(item.imageVersion)) : "";
    const mediaStart = item.etsyUrl
      ? '<a class="product-card-media product-card-link" href="' + escapeHtml(item.etsyUrl) + '" target="_blank" rel="noopener">'
      : '<div class="product-card-media">';
    const mediaEnd = item.etsyUrl ? '</a>' : '</div>';
    const etsyButton = item.etsyUrl
      ? '<a class="btn primary mini-button product-etsy" href="' + escapeHtml(item.etsyUrl) + '" target="_blank" rel="noopener">View on Etsy</a>'
      : "";
    article.innerHTML =
      mediaStart +
        (item.image ? '<img src="' + escapeHtml(item.image + imageVersion) + '" alt="' + escapeHtml(item.title) + '" loading="lazy" />' : '<div class="product-card-fallback">No preview</div>') +
      mediaEnd +
      '<div class="product-card-body">' +
        '<strong>' + escapeHtml(item.title) + '</strong>' +
        '<span class="product-card-price">' + escapeHtml(item.priceLabel || "Quote") + '</span>' +
        '<p>' + escapeHtml(item.description || "Ask about materials, sizing, and timing.") + '</p>' +
        '<div class="product-card-actions">' +
          etsyButton +
          '<button class="btn secondary product-inquire" type="button" data-product-id="' + escapeHtml(item.id) + '">Ask about this print</button>' +
        '</div>' +
      '</div>';
    return article;
  }

  function renderCatalog(items){
    if(!productMarquee || !productTrack || !productEmpty){
      return;
    }

    const normalized = Array.isArray(items) ? items.filter(function(item){
      return item && item.id && item.title;
    }) : [];

    productIndex = new Map();
    normalized.forEach(function(item){
      productIndex.set(item.id, item);
    });

    if(!normalized.length){
      productMarquee.hidden = true;
      productEmpty.hidden = false;
      productTrack.innerHTML = "";
      return;
    }

    productTrack.innerHTML = "";
    normalized.forEach(function(item){
      productTrack.appendChild(buildProductCard(item, false));
    });

    if(normalized.length > 1){
      normalized.forEach(function(item){
        productTrack.appendChild(buildProductCard(item, true));
      });
    }

    productMarquee.hidden = false;
    productEmpty.hidden = true;

    if(prefersReducedMotion){
      productTrack.classList.add("no-motion");
    }else{
      productTrack.classList.remove("no-motion");
    }

    if(currentPrintData){
      renderCurrentPrint(currentPrintData);
    }
  }

  async function loadCatalog(){
    if(!pageConfig.productCatalogUrl){
      return;
    }

    try{
      const response = await fetch(pageConfig.productCatalogUrl + "?ts=" + Date.now(), { cache: "no-store" });
      if(!response.ok){
        throw new Error("Catalog request failed");
      }
      const data = await response.json();
      renderCatalog(data.items || []);
    }catch(error){
      renderCatalog([]);
    }
  }

  function prefillInquiry(payload){
    if(!liveForm || !liveMessage){
      return;
    }

    if(liveType){
      liveType.value = "Quote request";
    }

    if(liveTiming && !liveTiming.value.trim()){
      liveTiming.value = "Please follow up with pricing and lead time.";
    }

    const nextMessage = payload.message || ("I am interested in " + payload.title + ".");
    if(!liveMessage.value.trim() || liveMessage.dataset.autoFilled === "true"){
      liveMessage.value = nextMessage;
      liveMessage.dataset.autoFilled = "true";
    }

    if(contactSelection){
      const fragments = [payload.title];
      if(payload.priceLabel){
        fragments.push(payload.priceLabel);
      }
      contactSelection.textContent = "Selected print: " + fragments.join(" - ");
      contactSelection.hidden = false;
    }

    liveForm.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    if(!document.getElementById("live-name").value.trim()){
      document.getElementById("live-name").focus();
    }else{
      liveMessage.focus();
    }
  }

  if(liveMessage){
    liveMessage.addEventListener("input", function(){
      if(liveMessage.dataset.autoFilled === "true" && liveMessage.value.trim() === ""){
        liveMessage.dataset.autoFilled = "false";
      }
    });
  }

  if(currentPrintInquiry){
    currentPrintInquiry.addEventListener("click", function(event){
      const message = currentPrintInquiry.dataset.message;
      const title = currentPrintInquiry.dataset.title;
      if(!message || !title){
        return;
      }
      event.preventDefault();
      prefillInquiry({
        title: title,
        priceLabel: currentPrintInquiry.dataset.price || "",
        message: message
      });
    });
  }

  if(productTrack){
    productTrack.addEventListener("click", function(event){
      const button = event.target.closest(".product-inquire");
      if(!button){
        return;
      }

      const item = productIndex.get(button.dataset.productId);
      if(!item){
        return;
      }

      prefillInquiry({
        title: item.title,
        priceLabel: item.priceLabel || "",
        message:
          item.inquiryMessage ||
          ("I am interested in the " + item.title + (item.priceLabel ? " (" + item.priceLabel + ")" : "") + ". Please tell me the current price, material options, and lead time.")
      });
    });
  }

  fullscreenBtn.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", syncFullscreenButton);
  document.addEventListener("webkitfullscreenchange", syncFullscreenButton);
  document.addEventListener("msfullscreenchange", syncFullscreenButton);
  syncFullscreenButton();

  const source = resolveSource();
  renderPlaceholder(defaultOfflineTitle.textContent, defaultOfflineText.textContent);
  setStatus("Checking status", "Checking whether an active print is currently broadcasting.", false);
  loadCurrentPrint();
  loadCatalog();

  if(source){
    if(source.kind === "cloudflare"){
      syncCloudflareLifecycle(source);
      document.addEventListener("visibilitychange", function(){
        if(document.hidden){
          scheduleLifecyclePoll(source);
          return;
        }
        syncCloudflareLifecycle(source);
      });
      window.addEventListener("focus", function(){
        syncCloudflareLifecycle(source);
      });
      window.addEventListener("beforeunload", clearLifecyclePollTimer);
    }else{
      setStatus("Live now", "The live viewer is connected.", true);
      streamMount.innerHTML = "";
      streamMount.appendChild(buildFrame(source));
    }
  }
})();
