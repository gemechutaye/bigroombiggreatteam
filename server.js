// server.js

const express = require('express');
const axios = require('axios');
const { LumaAI } = require('lumaai');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize Luma AI client
const client = new LumaAI({
  authToken: process.env.LUMA_API_KEY,
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // Serve static files from public directory
app.use('/generated', express.static(path.join(__dirname, 'generated')));

// Log incoming requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Helper function to create a timestamped folder
function createTimestampedFolder() {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '').slice(0, 15);
  const folderName = `generated/images_${timestamp}`;
  fs.ensureDirSync(folderName);
  return folderName;
}

// Helper function to generate a single image using Luma AI API
async function generateSingleImage(prompt, outputPath) {
  try {
    console.log('Making request to Luma AI with prompt:', prompt);

    // Create the initial generation
    let generation = await client.generations.image.create({
      prompt: prompt,
    });

    console.log('Initial response:', generation);

    let completed = false;
    let attempts = 0;
    const maxAttempts = 30;

    while (!completed && attempts < maxAttempts) {
      attempts++;
      console.log(`Polling attempt ${attempts}/${maxAttempts}`);

      generation = await client.generations.get(generation.id);
      console.log('Status response:', generation);

      if (generation.state === 'completed') {
        completed = true;

        // Download and save the image
        const imageUrl = generation.assets.image;
        console.log('Generated Image URL:', imageUrl); // Added logging
        
        const imageResponse = await axios({
          method: 'get',
          url: imageUrl,
          responseType: 'stream',
        });

        await new Promise((resolve, reject) => {
          imageResponse.data
            .pipe(fs.createWriteStream(outputPath))
            .on('finish', resolve)
            .on('error', reject);
        });

        return {
          success: true,
          imagePath: outputPath,
          imageUrl: imageUrl  // Renamed to be more clear
        };
      } else if (generation.state === 'failed') {
        throw new Error(`Generation failed: ${generation.failure_reason}`);
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!completed) {
      throw new Error('Generation timed out');
    }
  } catch (error) {
    console.error('Error generating image:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// Endpoint: Generate multiple images from prompts
app.post('/api/generateBatch', async (req, res) => {
  const { prompts, indices } = req.body;

  if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: 'No prompts provided' });
  }

  if (!process.env.LUMA_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    // Create output directory
    const outputDir = createTimestampedFolder();
    console.log('Created output directory:', outputDir);

    // Initialize response stream
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const results = [];
    const total = prompts.length;

    // Process each prompt
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i].trim();
      if (!prompt) continue;

      // Use provided index if this is a retry, otherwise use current index
      const currentIndex = indices ? indices[i] : i;
      const outputPath = path.join(
        outputDir,
        `image_${(currentIndex + 1).toString().padStart(2, '0')}.png`
      );

      // Send progress update
      res.write(`data: ${JSON.stringify({
        type: 'progress',
        current: i + 1,
        total,
        status: `Generating image ${currentIndex + 1}`
      })}\n\n`);

      const result = await generateSingleImage(prompt, outputPath);
      results.push({
        prompt,
        ...result,
        index: currentIndex
      });

      // Send result update
      res.write(`data: ${JSON.stringify({
        type: 'result',
        result: results[results.length - 1]
      })}\n\n`);
    }

    // Send completion update
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      results
    })}\n\n`);

    res.end();
  } catch (error) {
    console.error('Error in batch generation:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message
    })}\n\n`);
    res.end();
  }
});

// Endpoint: Generate video from image URL
app.post('/api/generateVideo', async (req, res) => {
  try {
    const { imageUrl, prompt } = req.body;
    console.log('Generating video from image:', imageUrl);
    console.log('Using prompt:', prompt);

    // Initialize Luma client
    const client = new LumaAI({
      authToken: process.env.LUMA_API_KEY
    });

    // Create video generation request
    const generation = await client.generations.create({
      prompt: prompt || "Create a cinematic animation from this image",
      keyframes: {
        frame0: {
          type: "image",
          image: {
            url: imageUrl
          }
        }
      }
    });

    console.log('Video generation started:', generation);

    // Poll for completion
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      attempts++;
      console.log(`Polling attempt ${attempts} for video ${generation.id}`);

      const status = await client.generations.get(generation.id);
      console.log('Video status:', status);

      if (status.state === 'completed' && status.assets && status.assets.video) {
        return res.json({
          success: true,
          videoUrl: status.assets.video
        });
      } else if (status.state === 'failed') {
        throw new Error(`Video generation failed: ${status.failure_reason || 'Unknown error'}`);
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('Video generation timed out');
  } catch (error) {
    console.error('Error generating video:', error);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
