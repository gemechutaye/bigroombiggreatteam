// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements
    const fileInput = document.getElementById('promptsFile');
    const generateBtn = document.getElementById('generateAll');
    const retryAllBtn = document.getElementById('retryAllFailed');
    const generateVideoBtn = document.getElementById('generateVideo');
    const progressBar = document.getElementById('progressBar');
    const statusMsg = document.getElementById('statusMessage');
    const logContainer = document.getElementById('logContainer');
    const gallery = document.getElementById('gallery');
    const progressContainer = document.getElementById('progressContainer');
    const failedItems = document.getElementById('failedItems');
    const failedItemsList = document.getElementById('failedItemsList');
    const videoControls = document.getElementById('videoControls');
    const videoInstructions = document.getElementById('videoInstructions');
    const videoPlayer = document.getElementById('videoPlayer');
    const videoSource = document.getElementById('videoSource');
  
    // Global state
    let generationLog = [];
    let failedPrompts = new Map(); // Map of index to {prompt, additionalPrompt}
    let successfulImages = new Map(); // Map of index to image path
    let originalPrompts = []; // Store original prompts
  
    // Event listeners
    fileInput.addEventListener('change', handleFileSelect);
    generateBtn.addEventListener('click', handleGenerate);
    retryAllBtn.addEventListener('click', () =>
      handleRetry(Array.from(failedPrompts.keys()))
    );
    generateVideoBtn.addEventListener('click', handleGenerateVideo);
  
    // Handle file selection
    async function handleFileSelect(e) {
      const file = e.target.files[0];
      if (!file) return;
  
      try {
        const text = await file.text();
        originalPrompts = parsePrompts(text);
  
        if (originalPrompts.length > 0) {
          log(`Loaded ${originalPrompts.length} prompts`);
          generateBtn.disabled = false;
          // Reset state
          failedPrompts.clear();
          successfulImages.clear();
          failedItems.style.display = 'none';
          videoControls.style.display = 'none';
          videoPlayer.style.display = 'none';
          gallery.innerHTML = '';
        } else {
          log('No valid prompts found in file', 'error');
          generateBtn.disabled = true;
        }
      } catch (err) {
        log('Error reading file: ' + err.message, 'error');
        generateBtn.disabled = true;
      }
    }
  
    // Parse prompts from text
    function parsePrompts(text) {
      return text
        .split(/\n\s*\n/)
        .map((block) => block.trim())
        .filter((block) => block.length > 0)
        .map((block) => {
          const lines = block.split('\n');
          const title = lines[0].trim();
          const description = lines.slice(1).join('\n').trim();
          return {
            title,
            prompt: description ? `${title}: ${description}` : title,
          };
        });
    }
  
    // Handle generate button click
    async function handleGenerate() {
      const prompts = originalPrompts.map((p) => p.prompt);
      if (prompts.length === 0) {
        log('No valid prompts found', 'error');
        return;
      }
  
      // Reset UI
      gallery.innerHTML = '';
      progressContainer.style.display = 'block';
      generateBtn.disabled = true;
      updateProgress(0);
      failedPrompts.clear();
      successfulImages.clear();
  
      await generateImages(prompts);
    }
  
    // Handle retry for specific indices
    async function handleRetry(indices) {
      if (indices.length === 0) return;
  
      try {
        const promptsToRetry = indices.map((index) => {
          const failedInfo = failedPrompts.get(index);
          return failedInfo.additionalPrompt
            ? `${failedInfo.prompt} ${failedInfo.additionalPrompt}`
            : failedInfo.prompt;
        });
  
        // Disable all retry buttons
        indices.forEach((index) => {
          const retryBtn = document.querySelector(`#retry-${index}`);
          if (retryBtn) retryBtn.disabled = true;
        });
  
        await generateImages(promptsToRetry, indices);
      } catch (err) {
        log('Retry error: ' + err.message, 'error');
        // Re-enable retry buttons
        indices.forEach((index) => {
          const retryBtn = document.querySelector(`#retry-${index}`);
          if (retryBtn) retryBtn.disabled = false;
        });
      }
    }
  
    // Generate images for given prompts
    async function generateImages(prompts, retryIndices = null) {
      try {
        progressContainer.style.display = 'block';
        updateProgress(0);
  
        // Send request
        const response = await fetch('/api/generateBatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompts,
            indices: retryIndices, // Pass indices if this is a retry
          }),
        });
  
        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }
  
        // Handle response stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
  
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
  
          const text = decoder.decode(value);
          for (const line of text.split('\n')) {
            if (line.startsWith('data: ')) {
              const event = JSON.parse(line.slice(6));
              handleServerEvent(
                event,
                retryIndices
                  ? prompts.map((p, i) => ({ prompt: p, index: retryIndices[i] }))
                  : originalPrompts.map((p, i) => ({ ...p, index: i }))
              );
            }
          }
        }
      } catch (err) {
        log('Generation error: ' + err.message, 'error');
        if (!retryIndices) {
          generateBtn.disabled = false;
        }
      }
    }
  
    // Handle generate video
    async function handleGenerateVideo() {
      if (successfulImages.size === 0) return;
  
      try {
        generateVideoBtn.disabled = true;
        progressContainer.style.display = 'block';
        updateProgress(0);
        statusMsg.textContent = 'Generating video...';
  
        // Get sorted image paths
        const imageList = Array.from(successfulImages.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([_, path]) => path);
  
        console.log('Sending images for video generation:', imageList);
  
        const instructions = videoInstructions.value.trim();
        const requestData = {
          images: imageList,
          instructions: instructions,
        };
  
        console.log('Sending video generation request:', requestData);
  
        const response = await fetch('/api/generateVideo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestData),
        });
  
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            `Server error: ${response.status}${
              errorData.details
                ? '\n' + JSON.stringify(errorData.details, null, 2)
                : ''
            }`
          );
        }
  
        const result = await response.json();
        if (result.generationId) {
          log(
            'Video generation started. Generation ID: ' + result.generationId,
            'success'
          );
          // Start polling for video status
          startPollingVideoStatus(result.generationId);
        } else {
          throw new Error('No generation ID in response');
        }
      } catch (err) {
        log('Video generation error: ' + err.message, 'error');
      } finally {
        generateVideoBtn.disabled = false;
        progressContainer.style.display = 'none';
      }
    }
  
    // Poll for video generation status
    async function startPollingVideoStatus(generationId) {
      const pollInterval = 5000; // 5 seconds
      const maxAttempts = 60; // 5 minutes total
      let attempts = 0;
  
      const checkStatus = async () => {
        try {
          const response = await fetch(`/api/videoStatus/${generationId}`);
          if (!response.ok) {
            throw new Error(`Failed to check status: ${response.status}`);
          }
  
          const data = await response.json();
          console.log('Video status:', data);
  
          if (data.status === 'completed' && data.videoUrl) {
            log('Video generation completed!', 'success');
            videoSource.src = data.videoUrl;
            videoPlayer.style.display = 'block';
            videoPlayer.load();
            return;
          } else if (data.status === 'failed') {
            throw new Error(
              `Video generation failed: ${data.error || 'Unknown error'}`
            );
          }
  
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(checkStatus, pollInterval);
          } else {
            throw new Error('Video generation timed out');
          }
        } catch (err) {
          log('Error checking video status: ' + err.message, 'error');
        }
      };
  
      checkStatus();
    }
  
    // Handle server events
    function handleServerEvent(event, prompts) {
      switch (event.type) {
        case 'progress':
          updateProgress((event.current / event.total) * 100);
          statusMsg.textContent = event.status;
          break;
  
        case 'result':
          const index = event.result.index;
          const prompt = prompts.find((p) => p.index === index);
          if (event.result.success) {
            if (prompt) {
              addImageToGallery(event.result, prompt);
              log(`Generated image ${index + 1}`, 'success');
              // Remove from failed if it was there
              failedPrompts.delete(index);
              // Add to successful
              successfulImages.set(index, event.result.imagePath);
              updateFailedItemsUI();
              updateVideoControlsUI();
            }
          } else {
            log(`Failed to generate image ${index + 1}: ${event.result.error}`, 'error');
            if (prompt) {
              failedPrompts.set(index, {
                prompt: prompt.prompt,
                additionalPrompt: '' // Space for additional prompt
              });
              updateFailedItemsUI();
            }
          }
          break;
  
        case 'complete':
          log('Generation completed', 'success');
          generateBtn.disabled = false;
          updateFailedItemsUI();
          updateVideoControlsUI();
          break;
  
        case 'error':
          log('Error: ' + event.error, 'error');
          generateBtn.disabled = false;
          break;
      }
    }
  
    // UI helpers
    function updateProgress(percent) {
      progressBar.style.width = percent + '%';
      progressBar.setAttribute('aria-valuenow', percent);
    }
  
    function addImageToGallery(result, promptData) {
      // The image URL comes from assets.image in the Luma API response
      const imageUrl = result.imageUrl;
      const escapedUrl = imageUrl.replace(/'/g, "\\'");
      const escapedPrompt = promptData.prompt.replace(/'/g, "\\'").replace(/"/g, '\\"');
      const html = `
        <div class="col-md-4 gallery-item">
          <div class="card mb-4">
            <img src="${result.imagePath}"
                 class="card-img-top"
                 alt="${promptData.prompt}">
            <div class="card-body">
              <p class="card-text"><strong>Prompt:</strong> ${promptData.prompt}</p>
              <p class="card-text"><strong>Image URL:</strong> <a href="${imageUrl}" target="_blank" onclick="copyToClipboard('${escapedUrl}'); return false;">${imageUrl}</a></p>
              <button class="btn btn-primary" onclick="generateVideo('${escapedUrl}', '${escapedPrompt}')">Generate Video</button>
              <div class="video-status" style="display: none;"></div>
            </div>
          </div>
        </div>
      `;
      gallery.insertAdjacentHTML('beforeend', html);
    }
  
    function updateFailedItemsUI() {
      if (failedPrompts.size > 0) {
        failedItems.style.display = 'block';
        retryAllBtn.disabled = false;
  
        failedItemsList.innerHTML = Array.from(failedPrompts.entries())
          .map(
            ([index, info]) => `
            <div class="col-md-12 mb-3">
              <div class="card border-danger">
                <div class="card-body">
                  <h5 class="card-title">Failed Image #${index + 1}</h5>
                  <p class="card-text">${info.prompt}</p>
                  <div class="input-group mb-3">
                    <input type="text"
                           class="form-control"
                           id="additional-prompt-${index}"
                           placeholder="Additional prompt (optional)"
                           value="${info.additionalPrompt || ''}"
                           onchange="window.updateAdditionalPrompt(${index}, this.value)">
                    <button class="btn btn-outline-danger"
                            type="button"
                            id="retry-${index}"
                            onclick="window.retryImage(${index})">
                      Retry This Image
                    </button>
                  </div>
                </div>
              </div>
            </div>
          `
          )
          .join('');
      } else {
        failedItems.style.display = 'none';
        retryAllBtn.disabled = true;
      }
    }
  
    function updateVideoControlsUI() {
      if (successfulImages.size > 0 && failedPrompts.size === 0) {
        videoControls.style.display = 'block';
        generateVideoBtn.disabled = false;
      } else {
        videoControls.style.display = 'none';
        generateVideoBtn.disabled = true;
      }
    }
  
    function log(message, type = 'info') {
      const entry = {
        time: new Date().toISOString(),
        message,
        type,
      };
      generationLog.push(entry);
  
      const div = document.createElement('div');
      div.className = `log-${type}`;
      div.textContent = `${entry.time.split('T')[1].split('.')[0]} - ${message}`;
      logContainer.appendChild(div);
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  
    // Expose functions for the retry buttons
    window.retryImage = (index) => {
      handleRetry([index]);
    };
  
    window.updateAdditionalPrompt = (index, value) => {
      const failedInfo = failedPrompts.get(index);
      if (failedInfo) {
        failedInfo.additionalPrompt = value;
        failedPrompts.set(index, failedInfo);
      }
    };
  
    // Make generateVideo a global function
    generateVideo = async function(imageUrl, prompt) {
      console.log('Generating video with:', { imageUrl, prompt });
      const button = event.target;
      const card = button.closest('.card');
      const statusDiv = card.querySelector('.video-status');
      
      try {
        // Update UI
        statusDiv.style.display = 'block';
        statusDiv.textContent = 'Generating video...';
        button.disabled = true;

        // Make API request
        const response = await fetch('/api/generateVideo', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            imageUrl: imageUrl, // Make sure this is the direct CDN URL
            prompt: prompt
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Server error');
        }

        const result = await response.json();

        if (result.success) {
          statusDiv.innerHTML = `
            <p class="mt-2">Video generated successfully!</p>
            <video controls class="w-100 mt-2">
              <source src="${result.videoUrl}" type="video/mp4">
              Your browser does not support the video tag.
            </video>
            <a href="${result.videoUrl}" target="_blank" class="btn btn-secondary mt-2">Open Video in New Tab</a>
          `;
        } else {
          throw new Error(result.error);
        }
      } catch (error) {
        console.error('Error:', error);
        statusDiv.textContent = `Error: ${error.message}`;
        button.disabled = false;
      }
    };
  
    function copyToClipboard(text) {
      navigator.clipboard.writeText(text).then(() => {
        alert('URL copied to clipboard!');
      }).catch(err => {
        console.error('Failed to copy:', err);
      });
    }
  });