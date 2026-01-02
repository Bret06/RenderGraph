// Define the needed modules.
const fs = require("fs");
const fsp = require("fs/promises");
const ffmpeg = require("fluent-ffmpeg");
const readline = require("readline");
const path = require("path");

// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Utility function to convert rl.question to a promise-based version
function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

// Program entry point.
(async () => {
    // Read the config file.
    const appConfig = JSON.parse(await fsp.readFile("./config.json"));

    // Ask the user what they want to do.
    console.log("Available actions:");
    console.log("  [1] Initilize a new project.");
    console.log("  [2] Render a project.");
    const action = await askQuestion("What would you like to do? > ");

    // Depending on the action, call the appropriate function.
    switch (action) {
        case "1":
            await initProject(appConfig);
            break;
        case "2":
            await renderProject(appConfig);
            break;
        default:
            console.log("Error > Invalid action selected. Exiting.");
            break;
    }

    // Close the readline interface.
    rl.close();
})();

// Main async function to Initilize the project.
async function initProject(appConfig) {
    // Get the directory and id from the user.
    const { directory, id } = await selectProjectAndID(appConfig.projects_directory, false);
    // Define some paths.
    const projectDirectory = path.join(appConfig.projects_directory, directory);
    const episodeDirectory = path.join(projectDirectory, id);

    // Define the config setup.
    const config = (fs.existsSync(path.join(projectDirectory, "default_config.json"))) ? JSON.parse(await fsp.readFile(path.join(projectDirectory, "default_config.json"))) : appConfig.default_config;

    // Create a function that will ask the user what they would like to do.
    async function promptAction() {
        // Clear the console.
        console.clear();
        // Display the config to the user.
        console.log("\nCurrent config:");
        console.log(JSON.stringify(config, null, 2));

        // Define a list of available actions.
        const actions = [
            {
                name: "Set Resolution",
                execute: async () => {
                    // Ask the user for the desired resolution.
                    const selectedResolution = await askQuestion("Enter the desired resolution (WIDTHxHEIGHT) > ");
                    // If the user didn't enter anything, return to the action prompt.
                    if (!selectedResolution) {
                        await promptAction();
                        return;
                    }
                    // Make sure the resolution is valid.
                    if (!/^\d+x\d+$/.test(selectedResolution)) {
                        console.log("Error > Invalid resolution format. Please use width,height (e.g., 1920x1080).");
                        await askQuestion("\nPress Enter to continue...");
                        await promptAction();
                        return;
                    }
                    // Parse and set the resolution.
                    const [width, height] = selectedResolution.split("x").map(Number);
                    config.resolution = [width, height];
                    // Return to the action prompt.
                    await promptAction();
                }
            },
            {
                name: "Add A Cut",
                execute: async () => {
                    // Grab a list of video files in the selected directory.
                    const videoFiles = (await fsp.readdir(episodeDirectory, { withFileTypes: true }))
                        .filter(d => d.isFile() && d.name.endsWith(".mp4"))
                        .map(d => d.name);
                    // Display the list of video files to the user.
                    console.log("Available video files:");
                    videoFiles.forEach((file, i) => {
                        if (file) console.log(`  [${i + 1}] ${file}`);
                    });

                    // Ask the user which file to use.
                    const videoFileIndex = await askQuestion("Which video file would you like to use for this cut? > ");
                    const videoFile = videoFiles[Number(videoFileIndex) - 1];

                    // If the user didn't select a valid file, return to the action prompt.
                    if (!videoFile) {
                        console.log("Error > Invalid video file selected.");
                        await askQuestion("\nPress Enter to continue...");
                        await promptAction();
                        return;
                    }

                    // Add the cut to the config.
                    config.cuts.push({
                        "video": {
                            "id": videoFile,
                            "volume": 1
                        },
                        "start": "00:00:00",
                        "end": "00:00:01"
                    });

                    // Get the index of the newly added cut.
                    const newCutIndex = config.cuts.length - 1;
                    // Allow the user to edit the cut before adding it.
                    await editCut(newCutIndex);

                    // Return to the action prompt.
                    await promptAction();
                }
            },
            {
                name: "Edit A Cut",
                execute: async () => {
                    await editCut();
                    await promptAction();
                }
            },
            {
                name: "Move Cut",
                execute: async () => {
                    // List the available cuts. 
                    console.log("Available cuts:");
                    config.cuts.forEach((cut, i) => {
                        console.log(`  [${i + 1}] ${cut.video.id}`);
                    });
                    // Ask the user which cut they would like to move.
                    const cutIndexInput = await askQuestion("Which cut would you like to move? > ");
                    const cutIndex = Number(cutIndexInput) - 1;
                    if (cutIndex < 0 || cutIndex >= config.cuts.length) {
                        console.log("Error > Invalid cut selected.");
                        await askQuestion("\nPress Enter to continue...");
                        await promptAction();
                        return;
                    }
                    // Clear the console.
                    console.clear();
                    // Ask the user if they would like to move the cut up or down.
                    const direction = await askQuestion("Would you like to move the cut up or down? (u/d) > ");
                    if (direction.toLowerCase() === "u" && cutIndex > 0) {
                        // Move the cut up.
                        const temp = config.cuts[cutIndex - 1];
                        config.cuts[cutIndex - 1] = config.cuts[cutIndex];
                        config.cuts[cutIndex] = temp;
                    } else if (direction.toLowerCase() === "d" && cutIndex < config.cuts.length - 1) {
                        // Move the cut down.
                        const temp = config.cuts[cutIndex + 1];
                        config.cuts[cutIndex + 1] = config.cuts[cutIndex];
                        config.cuts[cutIndex] = temp;
                    } else {
                        console.log("Error > Cannot move cut in that direction.");
                        await askQuestion("\nPress Enter to continue...");
                        await promptAction();
                        return;
                    }
                    // Return to the action prompt.
                    await promptAction();
                }
            },
            {
                name: "Edit Fade Durations",
                execute: async () => {
                    // Make a list of valid fade duration types.
                    const fadeTypes = ["in", "out", "crossfade"];
                    // Ask the user what fade duration they would like to edit.
                    console.log("Available fade duration types:");
                    fadeTypes.forEach((type, i) => console.log(`  [${i + 1}] ${type}`));
                    const fadeTypeInput = await askQuestion("Which fade duration type would you like to edit? > ");
                    const fadeType = fadeTypes[Number(fadeTypeInput) - 1];
                    // If the user didn't select a valid fade type, return to the action prompt.
                    if (!fadeType) {
                        console.log("Error > Invalid fade duration type selected.");
                        await askQuestion("\nPress Enter to continue...");
                        await promptAction();
                        return;
                    }
                    // Clear the console.
                    console.clear();
                    // Tell the user the current fade duration.
                    console.log(`Current ${fadeType} fade duration: ${config.fade_duration[fadeType]}s`);
                    // Ask the user for the desired fade duration.
                    const durationInput = await askQuestion(`Enter the desired ${fadeType} fade duration in seconds > `);
                    const duration = parseFloat(durationInput);
                    // If the user entered an invalid duration, return to the action prompt.
                    if (isNaN(duration) || duration < 0) {
                        console.log("Error > Invalid duration. Please enter a number greater than or equal to 0.");
                        await askQuestion("\nPress Enter to continue...");
                        await promptAction();
                        return;
                    }
                    config.fade_duration[fadeType] = duration;
                    // Return to the action prompt.
                    await promptAction();
                }
            },
            {
                name: "Save & Exit",
                execute: async () => {
                    // Save the config file.
                    const configPath = path.join(episodeDirectory, "config.json");
                    // Ensure the episode directory exists.
                    await fsp.mkdir(episodeDirectory, { recursive: true });
                    // Write the config file.
                    await fsp.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
                    console.log(`\nConfig Built > Saved to ${configPath}`);
                    // Ask the user if they would like to build the video.
                    const buildVideo = await askQuestion("\nWould you like to build the video now? (y/n) > ");
                    if (buildVideo.toLowerCase() === "y") {
                        await renderProject(appConfig, { directory, id });
                    }
                }
            }
        ];

        // Define a function that can be used to edit a cut.
        async function editCut(cutIndex) {
            // Clear the console.
            console.clear();
            // Get the cut to edit.
            let cut = config.cuts[cutIndex];
            if (!cutIndex && cutIndex !== 0) {
                // List the available cuts.
                console.log("Available cuts:");
                config.cuts.forEach((cut, i) => {
                    console.log(`  [${i + 1}] ${cut.video.id}`);
                });
                // Ask the user which cut they would like to edit.
                const cutIndexInput = await askQuestion("Which cut would you like to edit? > ");
                cut = config.cuts[Number(cutIndexInput) - 1];
                if (!cut) {
                    console.log("Error > Invalid cut selected.");
                    await askQuestion("\nPress Enter to continue...");
                    await promptAction();
                    return;
                }
            }

            // List the actions for editing the cut.
            const editActions = [
                {
                    name: "Volume",
                    execute: async () => {
                        // Tell the user the current volume.
                        console.log(`Current volume: ${cut.video.volume}`);
                        // Ask the user for the desired volume.
                        const volumeInput = await askQuestion("Enter the desired volume. > ");
                        const volume = parseFloat(volumeInput);
                        // If the user entered an invalid volume, return to the action prompt.
                        if (isNaN(volume) || volume < 0) {
                            console.log("Error > Invalid volume. Please enter a number greater than or equal to 0.");
                            await askQuestion("\nPress Enter to continue...");
                            await editCut(cutIndex);
                            return;
                        }
                        cut.video.volume = volume;
                    }
                },
                {
                    name: "Start Time",
                    execute: async () => {
                        // Tell the user the current start time.
                        console.log(`Current start time: ${cut.start}`);
                        // Ask the user for the start time.
                        const startTime = await askQuestion("Enter the start time for the cut (HH:MM:SS) > ");
                        // If the user entered times that are invalid then return to the action prompt.
                        const timeRegex = /^\d{2}:\d{2}:\d{2}$/;
                        if (!timeRegex.test(startTime)) {
                            console.log("Error > Invalid time format. Please use HH:MM:SS.");
                            await askQuestion("\nPress Enter to continue...");
                            await editCut(cutIndex);
                            return;
                        }
                        cut.start = startTime;
                    }
                },
                {
                    name: "End Time",
                    execute: async () => {
                        // Tell the user the current end time.
                        console.log(`Current end time: ${cut.end}`);
                        // Ask the user for the end time.
                        const endTime = await askQuestion("Enter the end time for the cut (HH:MM:SS) > ");
                        // If the user entered times that are invalid then return to the action prompt.
                        const timeRegex = /^\d{2}:\d{2}:\d{2}$/;
                        if (!timeRegex.test(endTime)) {
                            console.log("Error > Invalid time format. Please use HH:MM:SS.");
                            await askQuestion("\nPress Enter to continue...");
                            await editCut(cutIndex);
                            return;
                        }
                        cut.end = endTime;
                    }
                },
                {
                    name: "Add Audio Track",
                    execute: async () => {
                        // Show a list of audio files in the episode directory.
                        const audioFiles = (await fsp.readdir(episodeDirectory, { withFileTypes: true }))
                            .filter(d => d.isFile() && (d.name.endsWith(".mp3") || d.name.endsWith(".wav") || d.name.endsWith(".aac")))
                            .map(d => d.name);
                        console.log("Available audio files:");
                        audioFiles.forEach((file, i) => {
                            if (file) console.log(`  [${i + 1}] ${file}`);
                        });
                        // Ask the user which audio file to use.
                        const audioFileIndex = await askQuestion("Which audio file would you like to add? > ");
                        const audioFile = audioFiles[Number(audioFileIndex) - 1];
                        // If the user didn't select a valid file, return to the action prompt.
                        if (!audioFile) {
                            console.log("Error > Invalid audio file selected.");
                            await askQuestion("\nPress Enter to continue...");
                            await editCut(cutIndex);
                            return;
                        }
                        // Clear the console.
                        console.clear();
                        // Ask the user for the volume of the audio track.
                        const volumeInput = await askQuestion("Enter the desired volume for the audio track. > ");
                        const volume = parseFloat(volumeInput);
                        // Clear the console.
                        console.clear();
                        // Ask the user for the offset of the audio track.
                        const offsetInput = await askQuestion("Enter the desired offset for the audio track (HH:MM:SS) (Use -HH:MM:SS to reverse the offset.) > ");
                        // If the user entered an invalid offset, return to the action prompt.
                        const offsetRegex = /^-?\d{2}:\d{2}:\d{2}$/;
                        if (offsetInput && !offsetRegex.test(offsetInput)) {
                            console.log("Error > Invalid offset format. Please use HH:MM:SS or -HH:MM:SS.");
                            await askQuestion("\nPress Enter to continue...");
                            await editCut(cutIndex);
                            return;
                        }
                        // Add the audio track to the cut.
                        if (!cut.audio) cut.audio = [];
                        cut.audio.push({
                            "id": audioFile,
                            "volume": volume || 1.0,
                            "offset": offsetInput || "00:00:00"
                        });
                    }
                },
                {
                    name: "Remove Audio Track",
                    execute: async () => {
                        // If there are no audio tracks, return to the action prompt.
                        if (!cut.audio || cut.audio.length === 0) {
                            console.log("Error > No audio tracks to remove.");
                            await askQuestion("\nPress Enter to continue...");
                            await editCut(cutIndex);
                            return;
                        }
                        // List the audio tracks.
                        console.log("Audio tracks:");
                        cut.audio.forEach((track, i) => {
                            console.log(`  [${i + 1}] ${track.id}`);
                        });
                        // Ask the user which audio track to remove.
                        const audioTrackIndex = await askQuestion("Which audio track would you like to remove? > ");
                        const trackIndex = Number(audioTrackIndex) - 1;
                        if (trackIndex < 0 || trackIndex >= cut.audio.length) {
                            console.log("Error > Invalid audio track selected.");
                            await askQuestion("\nPress Enter to continue...");
                            await editCut(cutIndex);
                            return;
                        }
                        // Remove the audio track.
                        cut.audio.splice(trackIndex, 1);
                    }
                },
                {
                    name: "Delete Cut",
                    execute: async () => {
                        // Confirm the user wants to delete the cut.
                        const confirmDelete = await askQuestion("Are you sure you want to delete this cut? (y/n) > ");
                        if (confirmDelete.toLowerCase() === "y") {
                            config.cuts.splice(cutIndex, 1);
                            console.log("Cut deleted.");
                        }
                    }
                }
            ]

            // Clear the console.
            console.clear();
            // Ask the user what they would like to edit.
            console.log("What would you like to edit?");
            editActions.forEach((action, i) => console.log(`  [${i + 1}] ${action.name}`));
            // Get the user's selection.
            const editAction = await askQuestion("Select an option > ");
            // If the user didn't select a valid action, return to the action prompt.
            if (!editActions[Number(editAction) - 1]) {
                console.log("Error > Invalid action selected.");
                await askQuestion("\nPress Enter to continue...");
                await editCut(cutIndex);
                return;
            }
            // Clear the console.
            console.clear();
            // Execute the selected action.
            await editActions[Number(editAction) - 1].execute();
        }

        // Ask the user what they would like to do.
        console.log("Available actions:");
        actions.forEach((action, i) => console.log(`  [${i + 1}] ${action.name}`));
        const action = await askQuestion("What would you like to do? > ");
        // If the user didn't select a valid action, return to the action prompt.
        if (!actions[Number(action) - 1]) {
            console.log("Error > Invalid action selected.");
            await askQuestion("\nPress Enter to continue...");
            await promptAction();
            return;
        }
        // Clear the console.
        console.clear();
        // Execute the selected action.
        await actions[Number(action) - 1].execute();
    }
    await promptAction();
}

// Main async function to render the project.
async function renderProject(appConfig, video) {
    // Clear the console.
    console.clear();
    // Get the directory and id from the user.
    const { directory, id } = (video) ? video : await selectProjectAndID(appConfig.projects_directory);

    // Define the base directory for the selected project.
    const baseDirectory = path.join(appConfig.projects_directory, directory, id);
    // Define the output video path.
    const output = path.join(baseDirectory, "output.mp4");
    // Define the path to the config.
    const configPath = path.join(baseDirectory, "config.json");

    // Parse the config.
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const { cuts, fade_duration, resolution } = config;
    // Add directory and id to config. - This is for custom scripts.
    config.directory = directory;
    config.id = id;

    // If a custom script.js exists in the project directory, run it.
    const scriptPath = path.join(appConfig.projects_directory, directory, "script.js");
    if (fs.existsSync(scriptPath)) {
        await require(scriptPath)(config);
    }
    // Validate the cuts within the array.
    if (!Array.isArray(cuts) || cuts.length === 0) {
        console.error("ERROR > Config must include a non-empty cuts array.");
        return;
    }

    // Define the fade durations with defaults.
    const fadeIn = fade_duration?.in ?? 0;
    const fadeOut = fade_duration?.out ?? 0;
    const crossfade = fade_duration?.crossfade ?? 0;

    // This function is used to convert HH:MM:SS timestamps to seconds.
    function toSeconds(ts) {
        let isNegative = false;
        if (ts.startsWith("-")) {
            isNegative = true;
            ts = ts.slice(1);
        }
        const p = ts.split(":").map(Number);
        if (p.length !== 3) throw new Error("ERROR > Timestamp must be HH:MM:SS");
        return (isNegative) ? -1 * (p[0] * 3600 + p[1] * 60 + p[2]) : p[0] * 3600 + p[1] * 60 + p[2];
    }

    // Create our ffmpeg command.
    const cmd = ffmpeg();
    // Create the durations array to hold each cut's duration.
    const durations = [];
    // Create the cutInputs array to hold each cut's input indices.
    const cutInputs = [];
    // Create input index counter.
    let inputIndex = 0;

    // Loop through each cut to set up inputs.
    cuts.forEach((cut, i) => {
        // Validate cut structure.
        if (!cut.video?.id) {
            throw new Error(`ERROR > Cut ${i} missing video.id`);
        }

        // Define the duration of the cut.
        const start = toSeconds(cut.start);
        const end = toSeconds(cut.end);
        const duration = end - start;

        // Make sure duration is valid.
        if (duration <= 0) {
            throw new Error(`ERROR > Cut ${i}: end must be after start`);
        }

        // Store duration for later.
        durations.push(duration);

        // Define the path to the video file.
        const videoPath = path.join(baseDirectory, cut.video.id);
        // If the video file doesn't exist, throw an error.
        if (!fs.existsSync(videoPath)) {
            throw new Error(`ERROR > Cut ${i}: video not found → ${cut.video.id}`);
        }

        // Define the video input index.
        const videoIndex = inputIndex++;
        // Add the video input to the ffmpeg command.
        cmd.input(videoPath).inputOptions([`-ss ${start}`, `-t ${duration}`]);

        // Define array to hold audio input indices in order.
        const audioIndices = [];

        // Add the main video audio track first.
        audioIndices.push(videoIndex);

        // Make sure the structure of cut.audio is valid.
        if (!Array.isArray(cut.audio)) {
            cut.audio = [];
        }

        // Loop through each audio track in the cut.
        cut.audio.forEach(track => {
            // Make sure the audio track exists.
            const audioPath = path.join(baseDirectory, track.id);
            if (!fs.existsSync(audioPath)) {
                throw new Error(`ERROR > Cut ${i}: audio not found → ${track.id}`);
            }

            // Define the audio offset.
            const audioOffset = (track.offset) ? toSeconds(track.offset) : 0;

            // Define the audio input index.
            audioIndices.push(inputIndex++);
            // Add the audio input to the ffmpeg command.
            cmd.input(audioPath).inputOptions([`-ss ${start}`, `-t ${duration - audioOffset}`]);
        });

        // Store the cut input indices for later.
        cutInputs.push({ videoIndex, audioIndices });
    });

    // Define the filter array to hold all filter commands.
    const filter = [];
    // Define variables to hold the most recent video and audio stream labels.
    let vLast = null;
    let aLast = null;

    // Loop through each cut to set up filters.
    cuts.forEach((cut, i) => {
        // Define the input indices for this cut.
        const { videoIndex, audioIndices } = cutInputs[i];
        // Grab the first cut's duration.
        const duration = durations[i];

        // Define the base filter for this cut.
        let filterBase = `[${videoIndex}:v]setpts=PTS-STARTPTS,` +
            `scale=${resolution[0]}:${resolution[1]}:force_original_aspect_ratio=decrease,` +
            `pad=${resolution[0]}:${resolution[1]}:(ow-iw)/2:(oh-ih)/2`;
        // Set up the video stream with fade in/out filters as needed.
        if (i === 0) {
            // On the first cut, only apply fade in.
            filterBase += `,fade=t=in:st=0:d=${fadeIn}`;
        }
        if (i === cuts.length - 1) {
            // On the last cut, only apply fade out.
            filterBase += `,fade=t=out:st=${Math.max(0, duration - fadeOut)}:d=${fadeOut}`;
        }
        // Push the filter for the video stream.
        filter.push(
            filterBase +
            `[v${i}]`
        );

        // Loop through each audio input for this cut and adjust it's volume and add the fade in/out filters.
        audioIndices.forEach((inputIndex, currentAudioStream) => {
            // Define the volume for this audio stream. If the audio stream's index is 0 then it is the video's audio. Otherwise, it is an external audio track.
            const volume = currentAudioStream === 0 ? cut.video.volume ?? 1.0 : cut.audio[currentAudioStream - 1]?.volume ?? 1.0;
            // Define the audio offset.
            const audioOffset = currentAudioStream === 0 ? 0 : (cut.audio[currentAudioStream - 1]?.offset) ? toSeconds(cut.audio[currentAudioStream - 1]?.offset) : 0;
            const filterOffset = (audioOffset < 0) ? `atrim=start=${Math.abs(audioOffset)},asetpts=PTS-STARTPTS,` : (audioOffset > 0) ? `areverse,apad=pad_dur=${audioOffset},areverse,` : "";
            // Define the base audio filter for this cut.
            let audioFilterBase = `[${inputIndex}:a]asetpts=PTS-STARTPTS,` +
                filterOffset +
                `volume=${volume}`;
            // Add the fade in/out filters to the audio stream as needed.
            if (i === 0) {
                // On the first cut, only apply fade in.
                audioFilterBase += `,afade=t=in:st=0:d=${fadeIn}`;
            }
            if (i === cuts.length - 1) {
                // On the last cut, only apply fade out.
                audioFilterBase += `,afade=t=out:st=${Math.max(0, duration - fadeOut)}:d=${fadeOut}`;
            }
            // Push the filter for the audio stream.
            filter.push(
                audioFilterBase +
                `[a${i}_${currentAudioStream}]`
            );
        });

        // Mix all the audio stream labels for this cut together into a single string.
        const mixInputs = audioIndices.map((_, currentAudioStream) => `[a${i}_${currentAudioStream}]`).join("");
        // Add the amix filter to mix all audio streams together.
        filter.push(
            `${mixInputs}amix=inputs=${audioIndices.length}:normalize=0[a${i}]`
        );

        // If we are on the first cut, just set the latest video and audio labels.
        if (i === 0) {
            vLast = `v${i}`;
            aLast = `a${i}`;
            return;
        }

        // Define the offset of the current clips from the start of the video, adjusted for crossfades.
        const offset = durations.slice(0, i).reduce((a, b) => a + b, 0) - crossfade * i;

        // Add the current video cut to the previous using a crossfade.
        filter.push(
            `[${vLast}][v${i}]xfade=transition=fade:duration=${crossfade}:offset=${offset}[vxf${i}]`
        );
        // Add the current audio cut to the previous using a crossfade.
        filter.push(
            `[${aLast}][a${i}]acrossfade=d=${crossfade}[axf${i}]`
        );

        // Update the latest video and audio labels.
        vLast = `vxf${i}`;
        aLast = `axf${i}`;
    });

    // Calculate the total duration of the final video.
    const totalDuration =
        durations.reduce((a, b) => a + b, 0) -
        crossfade * (durations.length - 1);

    // Function to convert timemark (HH:MM:SS.xx) to seconds.
    function timemarkToSeconds(t) {
        const [h, m, s] = t.split(":");
        return (+h) * 3600 + (+m) * 60 + parseFloat(s);
    }
    // Set up the final output options and start processing.
    cmd
        .complexFilter(filter)
        .outputOptions([
            "-map", `[${vLast}]`,
            "-map", `[${aLast}]`,
            "-c:v", "h264_nvenc",
            "-preset", "p3",
            "-cq", "18",
            "-pix_fmt", "yuv420p",
            "-r", "60",
            "-c:a", "aac",
            "-b:a", "320k",
            "-shortest"
        ])
        .on("start", cmdLine => console.log("Exporting Video > \n", cmdLine))
        .on("progress", p => {
            if (!p.timemark) return;

            const current = timemarkToSeconds(p.timemark);
            const percent = Math.min(100, (current / totalDuration) * 100);

            process.stdout.write(
                `\rExporting > ${percent.toFixed(1)}% (${current.toFixed(1)}s / ${totalDuration.toFixed(1)}s)`
            );
        })
        .on("error", err => console.error("\nError >", err.message))
        .on("end", () => { console.log(`\nRender Complete > Saved as ${output}`); process.exit(0); })
        .save(output);
};

// Define a helper function to allow the user to select a project and episode ID.
async function selectProjectAndID(videoDirectoryPath, checkForConfig = true) {
    // Clear the console.
    console.clear();
    // List available directories by filtering for directories only.
    const videoDirectories = (await fsp.readdir(videoDirectoryPath, { withFileTypes: true }))
        .filter(d => d.isDirectory())
        .map(d => d.name);
    // Prompt user to select a directory.
    console.log("Available directories:");
    videoDirectories.forEach((dir, i) => console.log(`  [${i + 1}] ${dir}`));
    const directoryPrompt = await askQuestion("Please enter the directory of the project > ");
    // Make sure the selected directory exists.
    if (!videoDirectories.includes(videoDirectories[Number(directoryPrompt) - 1])) {
        console.log("Error > Invalid directory selected. Exiting.");
        process.exit(1);
    }
    // Define the selected directory.
    const directory = videoDirectories[Number(directoryPrompt) - 1];
    // List available episode IDs within each directory.
    const episodeDirectories = (await fsp.readdir(path.join(videoDirectoryPath, directory), { withFileTypes: true }))
        .filter(d => d.isDirectory())
        .map(d => d.name);
    // Clear the console.
    console.clear();
    // Prompt user to select a directory.
    console.log("Available episodes:");
    episodeDirectories.forEach((dir, i) => {
        // Check if the directory contains a config.json file.
        const configPath = path.join(videoDirectoryPath, directory, dir, "config.json");
        if (checkForConfig) {
            if (fs.existsSync(configPath)) console.log(`  [${i + 1}] ${dir}`);
        } else {
            if (!fs.existsSync(configPath)) console.log(`  [${i + 1}] ${dir}`);
        }
    });
    const idPrompt = await askQuestion("Please enter the id of the episode > ");
    // Define the selected id.
    const id = episodeDirectories[Number(idPrompt) - 1];
    // Make sure the selected episode exists.
    if (!episodeDirectories.includes(id)) {
        console.log("Error > Invalid episode ID selected. Exiting.");
        process.exit(1);
    }
    return { directory, id };
}