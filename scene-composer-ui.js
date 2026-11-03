/* Local picture and pixel-frame controls for Scene mode. */
(() => {
  'use strict';
  const studio = window.MINISH_STUDIO;
  const frames = window.MINISH_FRAMES;
  if (!studio || !frames) return;
  const $ = id => document.getElementById(id);
  const picturesDialog = $('picturesDialog');
  const framesDialog = $('framesDialog');
  if (!picturesDialog || !framesDialog) return;
  const frameChoices = [{ id: 'none', label: 'No frame', description: 'Keep the edges clear.' }, ...frames.styles.filter(style => style.id !== 'none')];
  const frameThemes = { none: 'remove clear', 'minish-woodland': 'The Minish Cap', 'hyrule-royal': 'A Link to the Past', 'dream-island': "Link's Awakening", 'classic-gold': 'The Legend of Zelda NES 8 bit', 'oracle-jewel': 'Oracle of Ages Oracle of Seasons' };
  let chosenFiles = [];
  let importing = false;
  let lastPictureId = null;
  let frameDraft = frames.normalize();
  let framePictureId = null;
  const frameSearch = $('frameSearch');
  const searchText = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  const live = document.createElement('p');
  live.className = 'composer-visually-hidden'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  $('sceneWorkspace').append(live);
  const say = message => { live.textContent = message; };
  const imageSelection = () => { const object = studio.selectedObject; return object?.kind === 'image' ? object : null; };
  const errorText = error => error?.message || 'Something went wrong. Please try another picture.';
  const callStudio = (method, ...args) => {
    if (typeof studio[method] !== 'function') throw new Error('A picture editor file is missing. Keep the app folder together and reopen Minish Studio.');
    return studio[method](...args);
  };
  const showError = (element, message) => { element.textContent = message || ''; element.hidden = !message; };
  const close = dialog => { if (dialog.open) dialog.close(); };
  const valueUnlessEditing = (id, value) => { if (document.activeElement !== $(id)) $(id).value = value; };

  function syncPictureInspector() {
    const image = imageSelection();
    $('pictureInspector').hidden = !image;
    $('sceneInspector').classList.toggle('has-picture-selection', !!image);
    $('pictureFrameTarget').disabled = !image;
    if (image) {
      if (document.activeElement !== $('pictureAspectLock')) $('pictureAspectLock').checked = image.keepAspect !== false;
      if (lastPictureId !== image.id) {
        $('pictureEditStatus').textContent = '';
      }
      valueUnlessEditing('pictureWidth', Math.round(image.w));
      valueUnlessEditing('pictureHeight', Math.round(image.h));
      valueUnlessEditing('pictureRotation', Math.round((image.rotation || 0) * 100) / 100);
      const source = studio.getImageMetadata?.(image.imageId);
      $('pictureSourceSize').textContent = source ? 'Original: ' + source.width + ' × ' + source.height + ' px. Drag to move; use the corner handles to resize.' : 'Drag to move; use the corner handles to resize.';
    }
    lastPictureId = image?.id || null;
    if (framesDialog.open && $('frameTarget').value === 'picture' && (!image || image.id !== framePictureId)) {
      $('frameTarget').value = 'scene';
      loadFrameDraft();
      $('frameApplyStatus').textContent = 'Picture selection changed. The frame now applies to the canvas.';
    }
    const sceneFrame = frames.normalize(studio.getScene().frame);
    const current = frameChoices.find(style => style.id === sceneFrame.style);
    $('sceneFramesBtn').title = 'Pixel frames · canvas: ' + (current?.label || 'No frame');
  }

  function changePicture(patch) {
    if (!imageSelection()) return;
    try {
      callStudio('updateSelectedImage', patch);
      $('pictureEditStatus').textContent = '';
      syncPictureInspector();
    } catch (error) {
      $('pictureEditStatus').textContent = errorText(error);
      syncPictureInspector();
    }
  }
  for (const [id, dimension] of [['pictureWidth', 'width'], ['pictureHeight', 'height']]) {
    $(id).addEventListener('change', () => {
      const input = $(id), value = Number(input.value);
      if (!input.value.trim() || !Number.isFinite(value) || value < 1 || value > 32768) {
        $('pictureEditStatus').textContent = 'Use a size between 1 and 32,768 pixels.';
        const image = imageSelection(); if (image) input.value = Math.round(dimension === 'width' ? image.w : image.h);
        return;
      }
      changePicture({ [dimension]: Math.round(value), keepAspect: $('pictureAspectLock').checked });
    });
  }
  $('pictureAspectLock').addEventListener('change', () => changePicture({ keepAspect: $('pictureAspectLock').checked }));
  $('pictureRotation').addEventListener('change', () => {
    const input = $('pictureRotation'), value = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(value) || Math.abs(value) > 36000) {
      $('pictureEditStatus').textContent = 'Enter a rotation between −36,000° and 36,000°.';
      input.value = imageSelection()?.rotation || 0;
      return;
    }
    changePicture({ rotation: value });
  });
  $('resetPictureRotationBtn').addEventListener('click', () => changePicture({ rotation: 0 }));
  for (const [id, mode] of [['fitPictureBtn', 'contain'], ['fillPictureBtn', 'cover']]) {
    $(id).addEventListener('click', () => {
      try { callStudio('fitSelectedImage', mode); syncPictureInspector(); }
      catch (error) { $('pictureEditStatus').textContent = errorText(error); }
    });
  }

  function showPictures() {
    chosenFiles = [];
    $('pictureFiles').value = '';
    $('pictureFileSummary').hidden = true;
    $('pictureFileList').replaceChildren();
    $('pictureImportStatus').textContent = '';
    showError($('pictureImportErrors'), '');
    $('importPicturesBtn').disabled = true;
    $('importPicturesBtn').textContent = 'Add pictures';
    picturesDialog.showModal();
    $('choosePicturesBtn').focus();
  }
  function chooseFiles(files) {
    if (importing) return;
    chosenFiles = Array.from(files || []);
    showError($('pictureImportErrors'), '');
    $('pictureImportStatus').textContent = '';
    $('pictureFileSummary').hidden = !chosenFiles.length;
    $('pictureFileCount').textContent = chosenFiles.length + (chosenFiles.length === 1 ? ' picture selected' : ' pictures selected');
    const list = $('pictureFileList'); list.replaceChildren();
    chosenFiles.slice(0, 6).forEach(file => { const item = document.createElement('li'); item.textContent = file.name; list.append(item); });
    if (chosenFiles.length > 6) { const item = document.createElement('li'); item.textContent = 'And ' + (chosenFiles.length - 6) + ' more'; list.append(item); }
    $('importPicturesBtn').disabled = !chosenFiles.length;
    updateImportLabel();
  }
  function updateImportLabel() {
    const carousel = picturesDialog.querySelector('input[name="picturePlacement"]:checked')?.value === 'carousel';
    $('importPicturesBtn').textContent = chosenFiles.length ? (carousel ? 'Create ' : 'Add ') + chosenFiles.length + (carousel ? (chosenFiles.length === 1 ? ' scene' : ' scenes') : (chosenFiles.length === 1 ? ' picture' : ' pictures')) : 'Add pictures';
  }
  function setImportBusy(busy) {
    importing = busy;
    picturesDialog.setAttribute('aria-busy', String(busy));
    for (const control of picturesDialog.querySelectorAll('button, input')) control.disabled = busy;
    if (!busy) $('importPicturesBtn').disabled = !chosenFiles.length;
  }
  $('addPicturesBtn').addEventListener('click', showPictures);
  $('choosePicturesBtn').addEventListener('click', () => $('pictureFiles').click());
  $('pictureFiles').addEventListener('change', event => chooseFiles(event.target.files));
  for (const radio of picturesDialog.querySelectorAll('input[name="picturePlacement"]')) radio.addEventListener('change', updateImportLabel);
  for (const id of ['closePicturesBtn', 'cancelPicturesBtn']) $(id).addEventListener('click', () => close(picturesDialog));
  picturesDialog.addEventListener('cancel', event => { if (importing) event.preventDefault(); });
  const fileArea = $('pictureFileArea');
  for (const type of ['dragenter', 'dragover']) fileArea.addEventListener(type, event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault(); event.stopPropagation();
    fileArea.classList.add('is-drop-target');
    event.dataTransfer.dropEffect = importing ? 'none' : 'copy';
  });
  fileArea.addEventListener('dragleave', event => { if (!fileArea.contains(event.relatedTarget)) fileArea.classList.remove('is-drop-target'); });
  fileArea.addEventListener('drop', event => {
    event.preventDefault(); event.stopPropagation(); fileArea.classList.remove('is-drop-target'); chooseFiles(event.dataTransfer.files);
  });
  $('importPicturesBtn').addEventListener('click', async () => {
    if (importing || !chosenFiles.length) return;
    const placement = picturesDialog.querySelector('input[name="picturePlacement"]:checked').value;
    showError($('pictureImportErrors'), '');
    $('pictureImportStatus').textContent = 'Preparing ' + chosenFiles.length + (chosenFiles.length === 1 ? ' picture…' : ' pictures…');
    setImportBusy(true);
    try {
      const result = await callStudio('importImages', chosenFiles, { placement });
      close(picturesDialog);
      say((result?.count || chosenFiles.length) + (placement === 'carousel' ? ' picture scenes created.' : ' pictures added to the scene.'));
      syncPictureInspector();
      if (placement === 'current') {
        // Reveal the existing Settings panel when a smaller screen has it hidden.
        if (getComputedStyle($('sceneInspector')).display === 'none') $('inspectorToggle').click();
      }
    } catch (error) {
      $('pictureImportStatus').textContent = '';
      showError($('pictureImportErrors'), errorText(error));
    } finally { setImportBusy(false); }
  });

  function filterFrames() {
    const query = searchText(frameSearch?.value), words = query.split(' ').filter(Boolean);
    let matches = 0;
    for (const button of $('frameStyles').querySelectorAll('button')) {
      const text = button.dataset.frameSearch, compact = text.replace(/ /g, '');
      button.hidden = !words.every(word => text.includes(word) || compact.includes(word));
      if (!button.hidden) matches++;
    }
    const result = $('frameResultCount');
    if (result) result.textContent = !query ? frames.styles.length + ' styles + No frame' : matches ? matches + (matches === 1 ? ' match' : ' matches') : 'No frames found. Try another Zelda theme.';
  }
  if (frameSearch) {
    frameSearch.setAttribute('aria-controls', 'frameStyles');
    frameSearch.addEventListener('input', filterFrames);
    // Native search controls may emit search when their clear button is used.
    frameSearch.addEventListener('search', filterFrames);
  }
  function drawFramePreviews() {
    for (const button of $('frameStyles').querySelectorAll('button')) {
      const canvas = button.querySelector('canvas'), ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const square = 9;
      for (let y = 0; y < canvas.height; y += square) for (let x = 0; x < canvas.width; x += square) {
        ctx.fillStyle = ((x / square + y / square) % 2) ? '#345566' : '#2b4859';
        ctx.fillRect(x, y, square, square);
      }
      frames.draw(ctx, { x: 0, y: 0, w: canvas.width, h: canvas.height, style: button.dataset.frameStyle, size: Number($('frameSize').value) });
      button.setAttribute('aria-pressed', String(button.dataset.frameStyle === frameDraft.style));
    }
    const choice = frameChoices.find(style => style.id === frameDraft.style) || frameChoices[0];
    $('frameDescription').textContent = choice.label + ' · ' + choice.description;
    $('applyFrameBtn').textContent = frameDraft.style === 'none' ? 'Remove frame' : 'Apply frame';
  }
  for (const style of frameChoices) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'frame-style-choice'; button.dataset.frameStyle = style.id;
    button.dataset.frameSearch = searchText(style.label + ' ' + style.description + ' ' + style.id + ' ' + (frameThemes[style.id] || '') + (style.id === 'none' ? '' : ' Zelda'));
    button.setAttribute('aria-label', style.label); button.setAttribute('aria-pressed', 'false');
    const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 108; canvas.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.textContent = style.label;
    const mark = document.createElement('i'); mark.textContent = '✓'; mark.setAttribute('aria-hidden', 'true');
    button.append(canvas, label, mark);
    button.addEventListener('click', () => { frameDraft = frames.normalize({ style: style.id, size: Number($('frameSize').value) }); drawFramePreviews(); });
    $('frameStyles').append(button);
  }
  function loadFrameDraft() {
    const image = imageSelection();
    framePictureId = image?.id || null;
    frameDraft = frames.normalize($('frameTarget').value === 'picture' ? image?.frame : studio.getScene().frame);
    $('frameSize').value = frameDraft.size;
    $('frameApplyStatus').textContent = '';
    drawFramePreviews();
  }
  function showFrames(target) {
    const image = imageSelection();
    if (frameSearch) frameSearch.value = '';
    $('frameStyles').scrollTop = 0;
    framesDialog.scrollTop = 0;
    $('pictureFrameTarget').disabled = !image;
    $('frameTarget').value = target === 'picture' && image ? 'picture' : 'scene';
    loadFrameDraft();
    filterFrames();
    framesDialog.showModal();
    $('frameTarget').focus();
  }
  $('sceneFramesBtn').addEventListener('click', () => showFrames('scene'));
  $('pictureFrameBtn').addEventListener('click', () => showFrames('picture'));
  $('frameTarget').addEventListener('change', loadFrameDraft);
  $('frameSize').addEventListener('change', () => { frameDraft = frames.normalize({ ...frameDraft, size: Number($('frameSize').value) }); drawFramePreviews(); });
  for (const id of ['closeFramesBtn', 'cancelFramesBtn']) $(id).addEventListener('click', () => close(framesDialog));
  $('applyFrameBtn').addEventListener('click', () => {
    const isPicture = $('frameTarget').value === 'picture';
    if (isPicture && (!imageSelection() || imageSelection().id !== framePictureId)) {
      $('frameApplyStatus').textContent = 'Select a picture before applying its frame.'; return;
    }
    try {
      if (isPicture) callStudio('setImageFrame', frameDraft); else callStudio('setSceneFrame', frameDraft);
      close(framesDialog);
      say(frameDraft.style === 'none' ? 'Frame removed.' : 'Frame applied to ' + (isPicture ? 'the selected picture.' : 'the entire canvas.'));
      syncPictureInspector();
    } catch (error) { $('frameApplyStatus').textContent = errorText(error); }
  });
  document.addEventListener('minish:selection-changed', syncPictureInspector);
  document.addEventListener('minish:scene-changed', syncPictureInspector);
  syncPictureInspector();
})();
