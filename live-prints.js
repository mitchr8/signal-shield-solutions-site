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
  let cloudflareAttachToken = 0;
  let cloudflareWhepSession = null;
  let lifecyclePollTimer = null;
  let lifecyclePollInFlight = false;
  let playbackWatchdogTimer = null;
  let currentPrintPollTimer = null;
  let currentPrintPollInFlight = false;
  let currentPrintData = null;
  let productIndex = new Map();
  let activeCloudflareVideo = null;
  let source = null;
  let embeddedSourceSignature = "";

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
    let resolved;
    if(/^https?:\/\//i.test(imagePath)){
      resolved = new URL(imagePath);
    }else{
      const base = new URL(baseUrl, window.location.href);
      const normalizedPath = (
        base.origin !== window.location.origin &&
        imagePath.startsWith("/")
      ) ? imagePath.slice(1) : imagePath;
      resolved = new URL(normalizedPath, base);
    }
    if(imageVersion){
      resolved.searchParams.set("v", imageVersion);
    }
    return resolved.toString();
  }

  function clearGeneratedCurrentPrintImage(){
    if(!currentPrintImage){
      return;
    }

    delete currentPrintImage.dataset.generated;
    delete currentPrintImage.dataset.snapshotKey;
  }

  function getCurrentPrintSnapshotKey(data){
    if(!data){
      return "";
    }

    return String(data.projectId || data.title || "").trim();
  }

  function applyCurrentVideoSnapshot(video){
    if(
      !video ||
      !currentPrintImage ||
      !currentPrintPlaceholder ||
      !currentPrintData ||
      currentPrintData.image
    ){
      return;
    }

    const snapshotKey = getCurrentPrintSnapshotKey(currentPrintData);
    if(!snapshotKey || video.readyState < 2 || !video.videoWidth || !video.videoHeight){
      return;
    }

    try{
      const canvas = document.createElement("canvas");
      const width = Math.min(video.videoWidth, 960);
      const height = Math.max(1, Math.round(width * (video.videoHeight / video.videoWidth)));
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if(!context){
        return;
      }
      context.drawImage(video, 0, 0, width, height);
      currentPrintImage.src = canvas.toDataURL("image/jpeg", 0.86);
      currentPrintImage.alt = currentPrintTitle ? currentPrintTitle.textContent : "Current print snapshot";
      currentPrintImage.hidden = false;
      currentPrintPlaceholder.hidden = true;
      currentPrintImage.dataset.generated = "true";
      currentPrintImage.dataset.snapshotKey = snapshotKey;
    }catch(error){
      console.error("Failed to capture current print snapshot", error);
    }
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

  function setConnectingStatus(noteText){
    setStatus(
      "Starting stream",
      noteText || "The camera is online, and the browser is establishing the live stream now.",
      false
    );
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

  function stopVideoElement(video){
    if(!video){
      return;
    }

    try{
      video.pause();
    }catch(error){
    }

    try{
      if(video.srcObject && typeof video.srcObject.getTracks === "function"){
        video.srcObject.getTracks().forEach(function(track){
          try{
            track.stop();
          }catch(error){
          }
        });
      }
    }catch(error){
    }

    try{
      video.srcObject = null;
    }catch(error){
    }

    try{
      video.removeAttribute("src");
      video.load();
    }catch(error){
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
    embeddedSourceSignature = "";
    streamMount.innerHTML = '<div class="stream-placeholder"><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(text) + '</p></div>';
  }

  function resetCloudflarePlayerState(){
    clearStreamAction();
    clearPlaybackWatchdog();
    stopVideoElement(activeCloudflareVideo);
    activeCloudflareVideo = null;
    closeCloudflareWhepSession();
    cloudflarePlayerMounted = false;
    streamMount.innerHTML = "";
  }

  function teardownCloudflarePlayer(){
    cloudflareAttachToken += 1;
    cloudflareAttachInFlight = false;
    resetCloudflarePlayerState();
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

  function isCurrentPrintStreamActive(){
    return Boolean(
      currentPrintData &&
      currentPrintData.cameraAvailable &&
      currentPrintData.active &&
      currentPrintData.streamPublic !== false
    );
  }

  function syncEmbeddedSource(sourceConfig){
    if(!sourceConfig || sourceConfig.kind === "cloudflare"){
      return;
    }

    if(!currentPrintData){
      setStatus("Checking status", "Checking whether an active print is currently broadcasting.", false);
      return;
    }

    if(isCurrentPrintStreamActive()){
      if(
        currentPrintData &&
        currentPrintData.streamPlatform === "youtube" &&
        currentPrintData.streamPublic === false
      ){
        teardownCloudflarePlayer();
        renderPlaceholder(
          "Live print is starting.",
          "The printer is active, and the public YouTube broadcast is still coming online."
        );
        embeddedSourceSignature = "";
        setConnectingStatus("The printer is active, and the public YouTube broadcast is still coming online.");
        return;
      }

      if(embeddedSourceSignature !== sourceConfig.url){
        teardownCloudflarePlayer();
        streamMount.innerHTML = "";
        streamMount.appendChild(buildFrame(sourceConfig));
        embeddedSourceSignature = sourceConfig.url;
      }
      setStatus("Live now", "An active print is currently broadcasting from the shop printer.", true);
      return;
    }

    teardownCloudflarePlayer();
    renderPlaceholder(
      "No active print is broadcasting right now.",
      "Check back when the next live print starts."
    );
    if(currentPrintData.active){
      setConnectingStatus("The printer is active locally. The live stream will appear once the broadcast destination is publishing.");
    }else{
      setStatus("Offline", "The live camera is offline right now. Check back during the next active print.", false);
    }
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

  function withTimeout(promise, timeoutMs, label){
    return new Promise(function(resolve, reject){
      const timeoutId = window.setTimeout(function(){
        reject(new Error(label));
      }, timeoutMs);

      Promise.resolve(promise).then(function(value){
        window.clearTimeout(timeoutId);
        resolve(value);
      }).catch(function(error){
        window.clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  async function fetchWithTimeout(url, options, timeoutMs){
    const controller = new AbortController();
    const timerId = window.setTimeout(function(){
      controller.abort();
    }, timeoutMs);

    try{
      const requestOptions = Object.assign({}, options || {}, { signal: controller.signal });
      return await fetch(url, requestOptions);
    }finally{
      window.clearTimeout(timerId);
    }
  }

  function scheduleCloudflareReconnect(source, noteText, delay){
    if(!source || source.kind !== "cloudflare"){
      return;
    }

    teardownCloudflarePlayer();
    renderPlaceholder(
      "Live print is reconnecting.",
      noteText || "The live stream dropped and is reconnecting automatically."
    );
    setConnectingStatus(noteText || "The live stream dropped and is reconnecting automatically.");
    scheduleLifecyclePoll(source, typeof delay === "number" ? delay : 2000);
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
    embeddedSourceSignature = "cloudflare";
    applyCurrentVideoSnapshot(activeCloudflareVideo);
    setStatus("Live now", "An active print is currently broadcasting from the shop printer.", true);
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
    let attachToken = 0;
    try{
      await (async function(){
        if(cloudflarePlayerMounted || cloudflareAttachInFlight){
          return;
        }

        attachToken = cloudflareAttachToken + 1;
        cloudflareAttachToken = attachToken;
        cloudflareAttachInFlight = true;
        resetCloudflarePlayerState();

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
        activeCloudflareVideo = video;

        streamMount.innerHTML = "";
        streamMount.appendChild(video);

        const optionsResponse = await fetchWithTimeout(source.playUrl, {
          method: "OPTIONS",
          mode: "cors",
          credentials: "omit",
          cache: "no-store"
        }, 10000);

        if(!optionsResponse.ok && optionsResponse.status !== 204){
          throw new Error("Cloudflare WHEP OPTIONS failed with status " + optionsResponse.status);
        }

        const peerConnection = new RTCPeerConnection({
          iceServers: parseIceServers(optionsResponse.headers.get("link"))
        });
        const remoteStream = new MediaStream();
        video.srcObject = remoteStream;
        video.addEventListener("loadedmetadata", function(){
          if(cloudflareAttachToken !== attachToken){
            return;
          }
          requestVideoPlayback(video, true);
        });
        video.addEventListener("canplay", function(){
          if(cloudflareAttachToken !== attachToken){
            return;
          }
          requestVideoPlayback(video, true);
        });
        video.addEventListener("playing", function(){
          if(cloudflareAttachToken !== attachToken){
            return;
          }
          markCloudflarePlaybackHealthy();
        });
        video.addEventListener("loadeddata", function(){
          if(cloudflareAttachToken !== attachToken){
            return;
          }
          if(remoteStream.getTracks().length){
            markCloudflarePlaybackHealthy();
          }
        });
        video.addEventListener("error", function(){
          if(cloudflareAttachToken !== attachToken){
            return;
          }
          scheduleCloudflareReconnect(source, "The player hit a stream error. Reconnecting automatically.", 2000);
        });

        peerConnection.addTransceiver("video", { direction: "recvonly" });
        peerConnection.addTransceiver("audio", { direction: "recvonly" });

        peerConnection.addEventListener("track", function(event){
          if(cloudflareAttachToken !== attachToken){
            return;
          }
          remoteStream.addTrack(event.track);
          requestVideoPlayback(video, true);
        });

        peerConnection.addEventListener("connectionstatechange", function(){
          if(cloudflareAttachToken !== attachToken){
            return;
          }
          if(peerConnection.connectionState === "failed" || peerConnection.connectionState === "disconnected" || peerConnection.connectionState === "closed"){
            scheduleCloudflareReconnect(source, "The live stream connection dropped. Reconnecting automatically.", 2000);
          }
        });

        peerConnection.addEventListener("iceconnectionstatechange", function(){
          if(cloudflareAttachToken !== attachToken){
            return;
          }
          if(peerConnection.iceConnectionState === "failed"){
            scheduleCloudflareReconnect(source, "The live stream network path failed. Reconnecting automatically.", 2000);
          }
        });

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await withTimeout(
          waitForIceGatheringComplete(peerConnection),
          10000,
          "Cloudflare WHEP ICE gathering timed out"
        );

        if(cloudflareAttachToken !== attachToken){
          try{
            peerConnection.close();
          }catch(error){
          }
          return;
        }

        const postResponse = await fetchWithTimeout(source.playUrl, {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          headers: {
            "Content-Type": "application/sdp"
          },
          body: peerConnection.localDescription.sdp
        }, 15000);

        if(!postResponse.ok){
          throw new Error("Cloudflare WHEP POST failed with status " + postResponse.status);
        }

        const answerSdp = await postResponse.text();

        if(cloudflareAttachToken !== attachToken){
          try{
            peerConnection.close();
          }catch(error){
          }
          return;
        }

        await peerConnection.setRemoteDescription({
          type: "answer",
          sdp: answerSdp
        });

        const resourceLocation = postResponse.headers.get("location");
        cloudflareWhepSession = {
          peerConnection: peerConnection,
          resourceUrl: resourceLocation ? new URL(resourceLocation, source.playUrl).toString() : ""
        };

        if(cloudflareAttachToken !== attachToken){
          closeCloudflareWhepSession();
          return;
        }

        cloudflareAttachInFlight = false;
        requestVideoPlayback(video, true);
        clearPlaybackWatchdog();
        playbackWatchdogTimer = window.setTimeout(function(){
          if(cloudflareAttachToken !== attachToken){
            return;
          }
          const hasTracks = remoteStream.getTracks().length > 0;
          const ready = video.readyState >= 2;
          const playing = !video.paused;
          if(ready || playing){
            markCloudflarePlaybackHealthy();
            return;
          }

          console.error("Cloudflare WHEP playback stalled before media became playable.");
          scheduleCloudflareReconnect(
            source,
            "The camera is online, but playback is still catching up. Retrying automatically.",
            hasTracks ? 3000 : 5000
          );
        }, 12000);
      })();
    }catch(error){
      if(cloudflareAttachToken === attachToken){
        cloudflareAttachInFlight = false;
      }
      throw error;
    }
  }

  function pickValue(paramName, configName){
    return (params.get(paramName) || streamConfig[configName] || "").trim();
  }

  function resolveSource(platformHint){
    const normalizedPlatformHint = String(platformHint || "").trim().toLowerCase();
    const preferredSource = (
      normalizedPlatformHint === "youtube" ? "youtube" :
      normalizedPlatformHint === "cloudflare" ? "cloudflare" :
      normalizedPlatformHint === "iframe" ? "iframe" :
      normalizedPlatformHint === "twitch" ? "twitch" :
      (pickValue("stream_source", "preferredSource") || "auto")
    ).toLowerCase();
    const iframeUrl = pickValue("iframe", "iframeUrl");
    const youtubeVideoId = pickValue("youtube", "youtubeVideoId");
    const youtubeChannelId = pickValue("youtube_channel", "youtubeChannelId");
    const twitchChannel = pickValue("twitch", "twitchChannel");
    const cloudflareCustomerCode = pickValue("cloudflare_code", "cloudflareCustomerCode");
    const cloudflareLiveInputId = pickValue("cloudflare_input", "cloudflareLiveInputId");
    const parent = window.location.hostname || "signalshieldsolutions.com";
    const candidates = {
      cloudflare: (cloudflareCustomerCode && cloudflareLiveInputId) ? {
        kind: "cloudflare",
        code: cloudflareCustomerCode,
        inputId: cloudflareLiveInputId,
        playUrl: "https://customer-" + encodeURIComponent(cloudflareCustomerCode) + ".cloudflarestream.com/" + encodeURIComponent(cloudflareLiveInputId) + "/webRTC/play",
        label: "Cloudflare Stream live input"
      } : null,
      iframe: iframeUrl ? {
        kind: "iframe",
        url: iframeUrl,
        label: "Custom live source"
      } : null,
      youtubeVideo: youtubeVideoId ? {
        kind: "youtube-video",
        url: "https://www.youtube.com/embed/" + encodeURIComponent(youtubeVideoId) + "?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&origin=" + encodeURIComponent(window.location.origin),
        label: "YouTube live feed"
      } : null,
      youtubeChannel: youtubeChannelId ? {
        kind: "youtube-channel",
        url: "https://www.youtube.com/embed/live_stream?channel=" + encodeURIComponent(youtubeChannelId) + "&autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&origin=" + encodeURIComponent(window.location.origin),
        label: "YouTube channel live feed"
      } : null,
      twitch: twitchChannel ? {
        kind: "twitch",
        url: "https://player.twitch.tv/?channel=" + encodeURIComponent(twitchChannel) + "&parent=" + encodeURIComponent(parent) + "&autoplay=true",
        label: "Twitch live feed"
      } : null
    };

    const preferredOrder = preferredSource === "youtube"
      ? [candidates.youtubeVideo, candidates.youtubeChannel, candidates.cloudflare, candidates.iframe, candidates.twitch]
      : preferredSource === "cloudflare"
        ? [candidates.cloudflare, candidates.youtubeChannel, candidates.youtubeVideo, candidates.iframe, candidates.twitch]
        : preferredSource === "iframe"
          ? [candidates.iframe, candidates.youtubeChannel, candidates.youtubeVideo, candidates.cloudflare, candidates.twitch]
          : preferredSource === "twitch"
            ? [candidates.twitch, candidates.youtubeChannel, candidates.youtubeVideo, candidates.cloudflare, candidates.iframe]
            : [candidates.cloudflare, candidates.youtubeChannel, candidates.youtubeVideo, candidates.iframe, candidates.twitch];

    return preferredOrder.find(Boolean) || null;
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
    if(!source || source.kind !== "cloudflare"){
      return;
    }
    clearLifecyclePollTimer();
    lifecyclePollTimer = window.setTimeout(function(){
      syncCloudflareLifecycle(source);
    }, typeof delay === "number" ? delay : getLifecyclePollDelay());
  }

  async function syncCloudflareLifecycle(source, options){
    if(!source || source.kind !== "cloudflare"){
      return;
    }

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
          setConnectingStatus("The camera is online, and the browser is establishing the live stream now.");
          attachCloudflarePlayer(source).catch(function(error){
            console.error("Cloudflare WHEP attach failed", error);
            teardownCloudflarePlayer();
            renderPlaceholder(
              "Live print is starting.",
              "The camera is online, but the browser is still establishing the stream. It should appear automatically."
            );
            setConnectingStatus("The camera is online, but the browser is still establishing the stream. Retrying automatically.");
            scheduleLifecyclePoll(source, 5000);
          });
        }
        cloudflareLiveState = true;
        if(cloudflarePlayerMounted){
          setStatus("Live now", "An active print is currently broadcasting from the shop printer.", true);
        }
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
      .replace(/[-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function titleCaseWord(word){
    if(!word){
      return "";
    }

    if(/^[A-Z0-9]{2,5}$/.test(word)){
      return word;
    }

    if(/^[a-z]+$/.test(word)){
      return word.charAt(0).toUpperCase() + word.slice(1);
    }

    return word;
  }

  function formatPrintLabel(value){
    const cleaned = cleanObjectName(value)
      .replace(/\b(?:official|final|copy)\b/ig, " ")
      .replace(/\bwall\s+trapped\b/ig, " ")
      .replace(/\bno\s+lid\b/ig, " ")
      .replace(/\btrapped\b/ig, " ")
      .replace(/\s+v(?=\d)/ig, " V")
      .replace(/\s+/g, " ")
      .trim();

    if(!cleaned){
      return "";
    }

    return cleaned
      .split(" ")
      .map(titleCaseWord)
      .join(" ");
  }

  function buildEntriesFromTitle(value){
    const parts = String(value || "")
      .split(/\s*\+\s*/)
      .map(function(part){
        return part.trim();
      })
      .filter(Boolean);

    return buildObjectEntries(parts);
  }

  function buildObjectEntries(objectNames){
    const ignoredNames = new Set(["wipe tower", "prime tower"]);
    const entries = [];
    const seen = new Map();

    objectNames.forEach(function(name){
      const formatted = formatPrintLabel(name);
      const normalized = normalizeCompareText(formatted);
      if(!normalized || ignoredNames.has(normalized)){
        return;
      }

      if(seen.has(normalized)){
        seen.get(normalized).count += 1;
        return;
      }

      const entry = {
        label: formatted,
        normalized: normalized,
        count: 1
      };
      seen.set(normalized, entry);
      entries.push(entry);
    });

    return entries;
  }

  function clampText(value, maxLength){
    const text = String(value || "").trim();
    if(text.length <= maxLength){
      return text;
    }

    const cut = text.slice(0, maxLength - 1);
    const boundary = cut.lastIndexOf(" ");
    return (boundary > 18 ? cut.slice(0, boundary) : cut).trim() + "\u2026";
  }

  function deriveCurrentPrintHeadline(data, objectEntries){
    if(objectEntries.length){
      const first = objectEntries[0];
      if(objectEntries.length === 1 && first.count > 1){
        return clampText(first.label, 68);
      }

      if(objectEntries.length > 1){
        return clampText(first.label + " and more", 68);
      }

      return clampText(first.label, 68);
    }

    return clampText(formatPrintLabel(data && data.title ? data.title : "Current print preview"), 68);
  }

  function buildCurrentPrintSummary(data, objectEntries){
    const totalObjects = Number(data && data.objectCount) || objectEntries.reduce(function(sum, entry){
      return sum + entry.count;
    }, 0);

    if(objectEntries.length === 1){
      if(totalObjects > 1){
        return totalObjects + " copies are on the build plate right now.";
      }
      return "This part is running on the printer right now.";
    }

    if(objectEntries.length > 1){
      return totalObjects + " parts are on the build plate right now.";
    }

    return data && data.note ? data.note : "Current plate preview paired with the live stream.";
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
    if(!data || !productIndex.size){
      return null;
    }

    const candidates = [];
    if(data.title){
      candidates.push(data.title);
    }
    if(Array.isArray(data.labels)){
      data.labels.forEach(function(label){
        if(label){
          candidates.push(label);
        }
      });
    }
    if(!candidates.length){
      return null;
    }

    let bestItem = null;
    let bestScore = 0;

    productIndex.forEach(function(item){
      candidates.forEach(function(candidate){
        const currentText = normalizeCompareText(candidate);
        const currentTokens = new Set(getCompareTokens(candidate));
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

    const etsyUrl = payload && payload.etsyUrl
      ? payload.etsyUrl
      : ((pageConfig.etsyShopUrl || "").trim());
    const etsyLabel = payload && payload.label
      ? payload.label
      : (pageConfig.etsyShopLabel || "Check out our Etsy");

    if(etsyUrl){
      currentPrintShopLink.href = etsyUrl;
      currentPrintShopLink.textContent = etsyLabel;
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
        currentPrintEyebrow.textContent = "Current plate";
      }
      clearGeneratedCurrentPrintImage();
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

    const objectNames = Array.isArray(data.objects) ? data.objects.map(cleanObjectName).filter(Boolean) : [];
    const objectEntries = buildObjectEntries(objectNames);
    const titleEntries = buildEntriesFromTitle(data.title);
    const displayEntries = objectEntries.length ? objectEntries : titleEntries;

    if(currentPrintEyebrow){
      currentPrintEyebrow.textContent = data.active ? "Current shop print" : "Recent shop print";
    }
    currentPrintTitle.textContent = deriveCurrentPrintHeadline(data, displayEntries);
    const matchedProduct = !data.image ? findMatchingProductForCurrentPrint({
      title: currentPrintTitle.textContent,
      labels: displayEntries.map(function(entry){
        return entry.label;
      })
    }) || findMatchingProductForCurrentPrint(data) : null;
    currentPrintSummary.textContent = buildCurrentPrintSummary(data, displayEntries);
    currentPrintState.textContent = data.gcodeState || (data.active ? "RUNNING" : "OFFLINE");
    if(typeof data.progress === "number"){
      currentPrintProgress.textContent = data.progress + "%";
    }else if(data.active){
      currentPrintProgress.textContent = "Updating";
      if(!data.note){
        currentPrintSummary.textContent = "The live stream is online. Progress is still updating from the printer.";
      }
    }else{
      currentPrintProgress.textContent = "--";
    }

    const totalObjectCount = Number(data.objectCount) || displayEntries.reduce(function(sum, entry){
      return sum + entry.count;
    }, 0);
    currentPrintObjectCount.textContent = totalObjectCount > 0 ? String(totalObjectCount) : "--";

    if(displayEntries.length){
      currentPrintObjects.hidden = false;
      const visibleEntries = displayEntries.slice(0, 3).map(function(entry){
        const suffix = entry.count > 1 ? ' <strong>x' + entry.count + '</strong>' : "";
        return '<span title="' + escapeHtml(entry.label) + '">' + escapeHtml(clampText(entry.label, 34)) + suffix + '</span>';
      });
      if(displayEntries.length > 3){
        visibleEntries.push('<span class="current-print-more">+' + (displayEntries.length - 3) + ' more</span>');
      }
      currentPrintObjects.innerHTML = visibleEntries.join("");
    }else{
      currentPrintObjects.hidden = true;
      currentPrintObjects.innerHTML = "";
    }

    if(data.image){
      clearGeneratedCurrentPrintImage();
      currentPrintImage.src = resolveCurrentPrintImageUrl(data.image, data.imageVersion);
      currentPrintImage.alt = data.title;
      currentPrintImage.hidden = false;
      currentPrintPlaceholder.hidden = true;
    }else if(matchedProduct && matchedProduct.image){
      clearGeneratedCurrentPrintImage();
      const version = matchedProduct.imageVersion ? ("?v=" + encodeURIComponent(matchedProduct.imageVersion)) : "";
      currentPrintImage.src = matchedProduct.image + version;
      currentPrintImage.alt = matchedProduct.title || data.title;
      currentPrintImage.hidden = false;
      currentPrintPlaceholder.hidden = true;
      currentPrintSummary.textContent = "Live plate thumbnail is not available for this job yet. Showing the closest matching catalog preview instead.";
    }else{
      const snapshotKey = getCurrentPrintSnapshotKey(data);
      const canUseGeneratedImage = (
        currentPrintImage.dataset.generated === "true" &&
        currentPrintImage.dataset.snapshotKey === snapshotKey &&
        !currentPrintImage.hidden &&
        currentPrintImage.getAttribute("src")
      );

      if(canUseGeneratedImage){
        currentPrintImage.hidden = false;
        currentPrintPlaceholder.hidden = true;
        if(data.active){
          currentPrintSummary.textContent = "Live camera snapshot paired with the current print details while the model preview is unavailable.";
        }
      }else{
        clearGeneratedCurrentPrintImage();
        currentPrintImage.hidden = true;
        currentPrintImage.removeAttribute("src");
        currentPrintPlaceholder.hidden = false;
      }
    }

    setCurrentPrintInquiry({
      title: currentPrintTitle.textContent,
      priceLabel: matchedProduct && matchedProduct.priceLabel ? matchedProduct.priceLabel : "",
      message:
        "I am interested in the current print: " + currentPrintTitle.textContent + ". " +
        (displayEntries.length ? "Objects on the plate: " + displayEntries.slice(0, 4).map(function(entry){
          return entry.label + (entry.count > 1 ? " x" + entry.count : "");
        }).join(", ") + ". " : "") +
        "Please tell me the price, available material options, and next steps."
    });
    setCurrentPrintShop({
      etsyUrl: pageConfig.etsyShopUrl || "",
      label: pageConfig.etsyShopLabel || "Check out our Etsy shop"
    });
  }

  async function loadCurrentPrint(){
    if(currentPrintPollInFlight){
      return;
    }

    const sources = [pageConfig.currentPrintUrl, pageConfig.currentPrintFallbackUrl].filter(Boolean);
    if(!sources.length){
      return;
    }

    currentPrintPollInFlight = true;
    const candidates = [];
    for(const sourceUrl of sources){
      try{
        const response = await fetch(withCacheBust(sourceUrl), { cache: "no-store" });
        if(!response.ok){
          throw new Error("Current print request failed");
        }
        const data = await response.json();
        if(data){
          candidates.push(data);
        }
      }catch(error){
      }
    }

    if(candidates.length){
      candidates.sort(function(left, right){
        const leftTime = Date.parse(left.updatedAt || "") || 0;
        const rightTime = Date.parse(right.updatedAt || "") || 0;
        return rightTime - leftTime;
      });

      const data = candidates[0];
      if(data && data.youtubeVideoId){
        streamConfig.youtubeVideoId = data.youtubeVideoId;
      }
      renderCurrentPrint(data);
      source = resolveSource(data && data.streamPlatform ? data.streamPlatform : "");
      if(source && source.kind === "cloudflare"){
        syncCloudflareLifecycle(source);
      }else{
        syncEmbeddedSource(source);
      }
      currentPrintPollInFlight = false;
      return;
    }

    renderCurrentPrint(null);
    if(!source){
      source = resolveSource("");
    }
    if(source && source.kind === "cloudflare"){
      syncCloudflareLifecycle(source);
    }else{
      syncEmbeddedSource(source);
    }
    currentPrintPollInFlight = false;
  }

  function clearCurrentPrintPollTimer(){
    if(currentPrintPollTimer){
      window.clearTimeout(currentPrintPollTimer);
      currentPrintPollTimer = null;
    }
  }

  function scheduleCurrentPrintPoll(delay){
    clearCurrentPrintPollTimer();
    currentPrintPollTimer = window.setTimeout(function(){
      loadCurrentPrint();
      scheduleCurrentPrintPoll(document.hidden ? 90000 : 15000);
    }, typeof delay === "number" ? delay : (document.hidden ? 90000 : 15000));
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
      ? '<a class="btn primary mini-button product-etsy" href="' + escapeHtml(item.etsyUrl) + '" target="_blank" rel="noopener">See listing</a>'
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

  source = null;
  renderPlaceholder(defaultOfflineTitle.textContent, defaultOfflineText.textContent);
  setStatus("Checking status", "Checking whether an active print is currently broadcasting.", false);
  loadCurrentPrint();
  scheduleCurrentPrintPoll();
  loadCatalog();

  document.addEventListener("visibilitychange", function(){
    if(!source){
      return;
    }

    if(source.kind === "cloudflare"){
      if(document.hidden){
        scheduleLifecyclePoll(source);
        return;
      }
      syncCloudflareLifecycle(source);
      return;
    }

    if(!document.hidden){
      syncEmbeddedSource(source);
    }
  });
  window.addEventListener("focus", function(){
    if(!source){
      return;
    }

    if(source.kind === "cloudflare"){
      syncCloudflareLifecycle(source);
    }else{
      syncEmbeddedSource(source);
    }
  });
  window.addEventListener("beforeunload", clearLifecyclePollTimer);
})();
