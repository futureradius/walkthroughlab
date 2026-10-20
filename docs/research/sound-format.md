# Sound format: which file loops cleanly on a Redmi Note 8 and on iPhones

Researched 2026-10-20 for issue #19, against the decisions in "What the viewer hears" (#13). Sources are pinned so the line numbers stay valid:

- This repo at commit `444bf50`. three.js citations are to the installed package, `node_modules/three` version 0.186.1, written as `path:line` relative to that folder.
- Chromium at [`fff931ec00`][cr-afr] for `media/filters/audio_file_reader.cc`, the file that decodes every `decodeAudioData` call in Chrome ([`content/renderer/media/audio_decoder.cc`][cr-decoder]). Chrome version numbers come from matching each change's commit position to the milestone branch points on [Chromium Dash][cr-milestones].
- WebKit at [`cf30450ee4`][wk-reader] for `AudioFileReaderCocoa.mm` and [`e427188d73`][wk-context] for `AudioContext.cpp`. The reader as it was before its 2026 rewrite is [`37a89f9dc7`][wk-reader-old].
- FFmpeg at [`744588782d`][ff-mp3], whose file readers Chrome uses.
- The Web Audio API 1.1 Working Draft of [22 September 2026][spec], the HTML Standard, and the codec specifications linked at the bottom.
- Support tables are the [caniuse data files][caniuse-data] and [MDN's compatibility data][bcd], both fetched on the research date.

How to read the claims in this note:

- A statement followed by a link or a path was **verified** in that source.
- **(reported)** means someone outside the browser team said it in a bug report. It is evidence, not a promise.
- **(computed)** means I worked the number out from figures given in the text.
- **(judgement)** means it is my inference, not something a source says.

Nothing here was played on a real phone. Every statement about what a browser does comes from reading its source code, its tests, its release notes or its bug tracker.

## 1. Short answer

**Use Opus in a WebM file, one format for both phones, and give every looping sound a little overlap at each end so the loop never touches the file's edges.**

- **Opus in WebM** is the smallest format that both phones decode, and the only compressed one where both browsers' source code shows the encoder's added silence being removed exactly at both ends. Chrome does this through FFmpeg, and its 2026 fixes to Opus did not touch WebM. Safari has done it in its own WebM reader since Safari 15 (2021).
- **Ogg Opus and Ogg Vorbis** reach iPhones only from iOS 18.4. Chrome's handling of the start of an Ogg Opus file was wrong until Chrome 148.
- **MP3 and AAC** play everywhere but are about twice the size for the same quality. They each have their own trap: MP3 is only trimmed when a non-standard header is present, and Safari 27.0 fails to decode some valid AAC files.
- **WAV and FLAC** add no silence at all, but are 10 to 20 times larger than Opus.

**The overlap matters more than the format.** Even when every sample is trimmed correctly, a compressed file is encoded as if there were silence before its first sample and after its last, so the join can still smear or tick. The fix uses only the Web Audio loop points, which every browser supports. The author exports the loop with a short copy of its own end in front and a short copy of its own start behind. The walkthrough then loops only the middle part with `loopStart` and `loopEnd`. Because the copies hold the same sound as the loop, the loop stays seamless even if a browser trims a few milliseconds more or less than it should **(judgement, from the loop rules in the [spec][spec-looping])**.

**Starting and pausing.** Both phones keep sound silent until a touch ends: the lift of the finger counts, not the moment it lands. iPhones also silence the walkthrough when the ringer switch is set to silent, unless the page asks iOS to treat it as media playback, and that request also pauses the viewer's own music. Neither phone can be relied on to pause the walkthrough's sound by itself when the page leaves the screen, so the walkthrough has to do that itself.

## 2. What three.js does with a sound file

three.js wraps the Web Audio API thinly. What it does under the hood decides which browser rules apply.

- **Loading.** `AudioLoader` downloads the whole file as bytes, copies them, and hands them to the browser's `decodeAudioData` (`src/loaders/AudioLoader.js:49-77`). The result is an `AudioBuffer`: the whole sound, decoded, held in memory as 32-bit numbers ([spec][spec-buffer]). So the browser's decoder, not three.js, decides whether the encoder's silence is cut off.
- **One shared audio context.** All sound runs in one browser `AudioContext`, created the first time anything asks for it (`src/audio/AudioContext.js:15-25`). Creating an `AudioListener` asks for it (`src/audio/AudioListener.js:41`), and so does `AudioLoader` when it decodes (`src/loaders/AudioLoader.js:62`). three.js never calls `resume()` on it anywhere in `src/audio/`, so starting sound after the first touch is up to the walkthrough.
- **Playing.** Every `play()` creates a new `AudioBufferSourceNode`, copies the `loop`, `loopStart` and `loopEnd` settings onto it, and starts it at the remembered position (`src/audio/Audio.js:332-338`). Looping is therefore the browser's sample-exact buffer loop, not a timer and not an `<audio>` element. The setters `setLoop`, `setLoopStart` and `setLoopEnd` exist (`src/audio/Audio.js:663-708`).
- **Pausing.** `pause()` works out how far playback has gone, stops the node at once and throws it away (`src/audio/Audio.js:358-385`). Stopping at once can click **(judgement)**. It also wraps the position by the whole buffer's length and ignores `loopStart` and `loopEnd` (`src/audio/Audio.js:373-377`), so after a pause, a sound with loop points can resume outside its loop body.
- **Volume.** `setVolume` glides to the new value over about 10 ms (`src/audio/Audio.js:731-733`, `src/audio/AudioListener.js:169`). A gentle fade-in on the first touch needs its own longer ramp on the listener's gain node.
- **Placed sounds.** `PositionalAudio` routes through a `PannerNode` set to the `HRTF` model (`src/audio/PositionalAudio.js:58-59`). Its distance settings (`refDistance`, `rolloffFactor`, `distanceModel`, `maxDistance`) are the browser's own fading with distance. How much `HRTF` costs on an old phone was not measured.
- **Old Safari.** `AudioLoader` chains `.catch()` onto `decodeAudioData` (`src/loaders/AudioLoader.js:67-77`), which only returns a promise from Safari 14.1, that is iOS 14.5 ([MDN data][bcd-bac]). On older iPhones the error handler would fire even when decoding works **(judgement, from the code)**. This does not matter if iOS 15 is the floor (section 6).

The spec itself expects decoded buffers to be "fairly short (usually somewhat less than a minute)" and says longer sounds should stream through an `<audio>` element ([spec][spec-buffer]). Decoded size does not depend on the file format: 48,000 samples a second × 4 bytes is about 11.5 MB per minute for each channel, so a one-minute stereo ambient sound takes about 23 MB of the phone's memory however small the file was **(computed)**.

## 3. Which formats each phone can decode

### The two phones

- **Redmi Note 8.** Current Chrome needs Android 10 or later ([Google][chrome-reqs]). Google said Chrome 138 was the last version for Android 8 and 9 (reported in the press; I did not find Google's original notice). The phone shipped with Android 9. Whether a given handset has the Android 11 update is something to read off its Settings, not something I could confirm from Xiaomi. On Android 10 or later it gets current Chrome, 155 on the research date ([Chromium Dash][cr-android-stable]); on Android 9 it stays on 138. Both matter below.
- **iPhones.** Safari's version is the iOS version (Safari 18.4 comes with iOS 18.4). Every browser on an iPhone uses WebKit, so what follows applies to Chrome on an iPhone too.

### What decodes, and from when

The caniuse tables describe the `<audio>` element, not `decodeAudioData` ([caniuse notes][caniuse-opus]). The spec says `decodeAudioData` takes "any of the formats supported by the audio element" ([spec][spec-decode]), but WebKit has not always followed this: WebM Opus decoded in Web Audio on iPhones years before `<audio>` played it (row 6).

| Format | Chrome on Android | Safari on iPhone |
|---|---|---|
| MP3 | Yes ([caniuse][caniuse-mp3]) | Yes, every iOS in the table ([caniuse][caniuse-mp3]) |
| AAC in `.m4a` | Yes ([caniuse][caniuse-aac]) | Yes ([caniuse][caniuse-aac]). **Safari 27.0 and 27.1** fail to decode some valid AAC/M4A files; fixed in the 27.2 beta ([Safari 27.2 notes][saf-27-2]) |
| Ogg Vorbis | Yes ([caniuse][caniuse-vorbis]) | Vorbis sound only from iOS 17.4, and only inside WebM ([Safari 17.4 notes][saf-17-4], [caniuse][caniuse-vorbis]); in an Ogg file from **iOS 18.4** ([Safari 18.4 notes][saf-18-4]) |
| Opus in Ogg | Yes ([caniuse][caniuse-opus]) | From **iOS 18.4** ([Safari 18.4 notes][saf-18-4]) |
| Opus in CAF (Apple's own container) | No ([caniuse][caniuse-opus], note 1 is Apple-only) | From iOS 11, constant bit rate only ([caniuse][caniuse-opus]) |
| Opus in WebM | Yes ([caniuse][caniuse-opus]) | `decodeAudioData`: added in WebKit in July 2021 ([bug 227110][wk-227110]), which shipped as "support for the Opus audio codec in WebM containers" in Safari 15 ([Safari 15 notes][saf-15]). A developer reported in 2022 that it worked on iPhones while `<audio>` did not **(reported)** ([bug 238546][wk-238546]). `<audio>`: from iOS 17.4, fully from 17.5 ([caniuse][caniuse-opus]) |
| Opus in MP4 | Yes (Chromium tests decode `opus-trimming-test.mp4`, [commit][cr-ogg-fix]) | From **Safari 27** only ([Safari 27 notes][saf-27]) |
| FLAC | Yes ([caniuse][caniuse-flac]) | From iOS 11 ([caniuse][caniuse-flac]) |
| WAV | Yes ([caniuse][caniuse-wav]) | Yes ([caniuse][caniuse-wav]) |

Two more facts shape the table:

- **Unprefixed Web Audio on iPhones starts at iOS 14.5**; before that only `webkitAudioContext` exists ([caniuse][caniuse-webaudio]), which three.js falls back to (`src/audio/AudioContext.js:19`).
- **On iPhones, `canPlayType` cannot be trusted to answer "will this decode".** WebKit once made it report Opus and Vorbis as unsupported on purpose ([bug 226922][wk-226922]), and later reports describe it disagreeing with what `decodeAudioData` accepts ([bug 238546][wk-238546]). It is simpler to decode and catch the error **(judgement)**.

## 4. Where silence creeps in, format by format

### Why compressed files gain silence

Compressed formats work on fixed-size blocks and need some history before their output is right, so encoders add samples that are not part of the sound. Opus calls the samples at the start "pre-skip": "the first few samples produced by the decoder do not correspond to real input audio" ([RFC 7845 §4.2][rfc7845-preskip]). At the end, the encoder pads the last block, and the file says how much to drop ([RFC 7845 §4.4][rfc7845-end]). AAC's start is almost always 2112 samples, and its end padding is under 1024 samples ([Apple TN2258][tn2258]). If the browser keeps any of these, a loop has a gap. A typical Opus pre-skip of 312 samples is 6.5 ms at 48 kHz, as in the test files of both browsers ([WebKit test][wk-test-ogg-opus], [Chromium commit][cr-ogg-fix]). AAC's 2112 samples are 44 ms **(computed)**.

How each format records what to cut:

- **MP3** has no standard place for it. LAME and similar encoders write it into an extra "Xing/Info" header with a LAME extension; FFmpeg reads the start and end padding from there ([`mp3dec.c:258-272`][ff-mp3]), and from Apple's `iTunSMPB` comment when there is no LAME header ([`mp3dec.c:345-377`][ff-mp3]). An MP3 without either header cannot be trimmed.
- **AAC in `.m4a`** carries it in the MP4 container ([TN2258][tn2258]). Raw `.aac` (ADTS) files have no place for it ([TN2258][tn2258]).
- **Opus in Ogg** carries pre-skip in its header and the end in the last page's position ([RFC 7845 §4.2, §4.4, §5.1][rfc7845-preskip]).
- **Opus in WebM** carries the same amounts as `CodecDelay` on the track and `DiscardPadding` on the last block ([RFC 9559 §5.1.4.1.25][rfc9559-codecdelay], [§5.1.3.5.7][rfc9559-discard]). FFmpeg's Opus encoder records its lookahead as the delay ([`libopusenc.c:101`, `:431`][ff-libopus]) and its end padding as skip data ([`encode.c:187`][ff-encode]), and its WebM writer turns those into the two elements ([`matroskaenc.c:2090-2098`, `:2919-2930`][ff-mkv]).
- **Ogg Vorbis** has no start delay to speak of; the end is trimmed from the last page's position, and the start can be trimmed the same way ([Vorbis I spec, A.2][vorbis-ogg]).
- **WAV and FLAC** are exact copies of the samples, so nothing is added.

### What Chrome does

All of Chrome's decoding goes through `AudioFileReader`, which reads the file with FFmpeg and then:

- drops every decoded sample whose time is before zero, which is where FFmpeg places the start padding it knows about ([`audio_file_reader.cc:227-236`][cr-afr]);
- passes on the start and end padding FFmpeg reports, trimming the front only on the first packet ([`audio_file_reader.cc:442-450`][cr-afr]);
- for AAC, also trims the end of the last block from the file's packet table, or failing that from the file's stated length ([`audio_file_reader.cc:259-318`][cr-afr]).

Format by format:

- **MP3 with a LAME header:** trimmed at both ends, by the route above.
- **AAC in `.m4a`:** the end trim from the file's stated length, needed for files made with Apple's `afconvert`, arrived in **Chrome 151** ([commit, position 1644192][cr-aac-fix]). Chrome 138 on Android 9 lacks it. I did not trace how FFmpeg's MP4 reader handles the start in Chrome's copy of it.
- **Opus in Ogg:** wrong before **Chrome 148**. FFmpeg both trimmed pre-skip itself and reported it, so Chrome trimmed it twice. A test file grew by exactly 312 samples when this was fixed ([commit, position 1608813][cr-ogg-fix]). In the same change, a ChromeOS test that allowed for an older decoding path "incorrectly includ[ing] the preskip samples" was tightened ([same commit][cr-ogg-fix]). Either way, before 148 the start of an Ogg Opus file was off by one pre-skip.
- **Opus in WebM:** the same commit says FFmpeg trims WebM Opus internally and reports only the end padding, and its fix applies only to Ogg ([commit][cr-ogg-fix], [`audio_file_reader.cc:99-108`][cr-afr]). After the fix, the WebM and Ogg versions of the same test sound decode to the same samples ([commit][cr-ogg-fix]). That is why WebM Opus has been right in Chrome both before and after 148 **(judgement, from the code, not measured on Chrome 138)**.
- **Vorbis:** Chromium's own tests note that some Vorbis files decode one sample too long ([same commit, `TODO(crbug.com/485920243)`][cr-ogg-fix]).

Chrome rewrote parts of this decoding during 2026: a new Opus decoder on by default ([commit][cr-opus-direct], [`media_switches.cc`][cr-switches]) and a second decoder library for some formats on some platforms ([commit][cr-symphonia]). The trimming above happens in `AudioFileReader` after decoding, whichever decoder runs ([`audio_file_reader.cc:221-252`][cr-afr]).

### What Safari does

Safari has two routes, and Safari 27 changed one of them.

- **WebM files** always go through WebKit's own WebM reader ([old `AudioFileReaderCocoa.cpp:150-155`][wk-reader-old], [`AudioFileReaderCocoa.mm:311-316`][wk-reader]). It drops `CodecDelay` samples at the start and `DiscardPadding` samples at the end ([old `:360-362`][wk-reader-old], [`:535-536`, `:669-683`][wk-reader]). This "frame-perfect decoding for Opus and Vorbis in WebM" landed in August 2021, in time for Safari 15 ([commit][wk-228140]). WebKit's test since then expects a one-second WebM Opus file to decode to exactly 47,688 samples, one second less its 312-sample pre-skip ([test][wk-test-webm-opus]). The same commit says the Vorbis count could not be tested because of a Vorbis decoder bug ([commit][wk-228140]).
- **Every other file, up to Safari 26.x**, went through Apple's `ExtAudioFile` ([old `:157-161`][wk-reader-old]). Apple documents that `ExtAudioFile` removes AAC's start and end padding automatically, reading the amounts from the file or using the default 2112 ([TN2258][tn2258]). WebKit later noted that this route left the start padding in raw `.aac` (ADTS) files as silence ([commit message][wk-309140]). I found no Apple statement on whether it trims MP3, or the Ogg files it accepts from iOS 18.4.
- **Every other file, from Safari 27**, goes through `AVAssetReader`, which marks how much to trim on each block; WebKit then sums and drops those amounts ([`:427-443`, `:669-683`][wk-reader]). The change shipped as Safari 27's fix for "MP4 files containing Opus audio tracks" ([Safari 27 notes][saf-27], [commit][wk-309140]). Its tests expect a LAME-tagged half-second MP3 to give exactly 24,000 samples, an AAC file to lose its 2112 start samples, and an Ogg Opus file to lose its 312 ([MP3 test][wk-test-mp3], [AAC test][wk-test-aac], [Ogg Opus test][wk-test-ogg-opus]).
- **This rewrite broke Ogg decoding** until a fix in June 2026 ([commit 314462@main][wk-ogg-regression]). I could not establish whether Safari 27.0 shipped with the fix.

### Summary

| Format | Silence added | Chrome removes it? | Safari removes it? |
|---|---|---|---|
| MP3 | Start and end, recorded only in an optional LAME or `iTunSMPB` header | Yes, if the header is there | Safari 27: yes, in its test. Up to 26.x: not confirmed |
| AAC `.m4a` | 2112 at the start, under 1024 at the end | End: fully only from Chrome 151. Start: not traced | Up to 26.x: yes (TN2258). 27: yes |
| AAC `.aac` | Same, with nowhere to record it | Start not trimmed, end not trimmed (no reliable length) | Up to 26.x: start left in. 27: yes |
| Opus in Ogg | Pre-skip (6.5 ms typical) and end padding | From Chrome 148 only | 18.4 to 26.x: not confirmed. 27: yes, after an Ogg decoding regression |
| Opus in WebM | Same, as `CodecDelay` and `DiscardPadding` | Yes (not measured on 138) | Yes, since Safari 15 |
| Vorbis | End padding only | Yes, to within a sample | Not confirmed |
| WAV, FLAC | None | Nothing to remove | Nothing to remove |

### Workarounds and how dependable each is

- **Gapless headers (LAME, `iTunSMPB`).** They help only where the decoder reads them, and which encoders write them correctly varies. Dependable only for the browsers and encoders tested **(judgement)**.
- **Trimming samples by hand.** The page could cut a known number of samples off the decoded buffer. But the right number depends on whether that browser already trimmed, and that differs by format and version as the tables show. Fragile **(judgement)**.
- **Loop points with an overlap (recommended).** `loopStart` and `loopEnd` have had sub-sample accuracy in every browser since Safari 7 and Chrome 24 ([MDN data][bcd-absn]). The spec splices the loop's end to its start "just as if the looped audio occurred in sequential, non-looped regions of the buffer" ([spec][spec-looping]). Export the file as *[last 100 ms of the loop] + [the loop] + [first 100 ms of the loop]*, then set `loopStart` to 0.1 s and `loopEnd` to 0.1 s plus the loop's length. Every stretch of that file one loop long sounds the same, so:
  - a browser that trims a little too much or too little at the start shifts the loop by the same amount but keeps it seamless, as long as the error is under 100 ms **(judgement)**;
  - the encoder's guess at "silence before and after" falls on the copies, not on the join. RFC 7845 recommends 80 ms of history for the Opus decoder to settle when cutting an encoded stream ([§4.2][rfc7845-preskip]), which is where the 100 ms comes from **(judgement)**;
  - the same holds when the browser resamples the whole buffer to the phone's rate ([spec][spec-decode]) and the resampler has nothing to work with past the buffer's edges **(judgement)**.

  In three.js this is `setLoop(true)`, `setLoopStart(…)`, `setLoopEnd(…)`. The cost is 200 ms of extra file per loop. Footsteps and door sounds play once and do not need it.

## 5. File size per minute

At 48 kHz, which Opus always decodes to ([RFC 7845 §5.1][rfc7845-header]) and which is the safest rate to author at **(judgement)**. Sizes are bit rate × 60 ÷ 8 **(computed)**:

| Format and setting | Per minute |
|---|---|
| Opus, mono, 32 kbit/s | 240 KB |
| Opus, mono, 48 kbit/s | 360 KB |
| Opus, stereo, 64 kbit/s | 480 KB |
| Opus, stereo, 96 kbit/s | 720 KB |
| AAC or MP3, stereo, 128 kbit/s | 960 KB |
| WAV, 16-bit, mono | 5.8 MB |
| WAV, 16-bit, stereo | 11.5 MB |
| FLAC | very roughly half of WAV **(judgement)** |

Xiph, who own Opus, list 64 to 96 kbit/s for streamed stereo music and 96 to 128 kbit/s for stored stereo music, and say Opus is full bandwidth from about 16 kbit/s mono ([Xiph][xiph-opus]). The ambient sound is rain, wind, room tone or traffic, not music, and is heard through a phone speaker or earphones. **Mono 32 to 48 kbit/s for placed sounds, footsteps, doors and the elevator, and stereo 64 kbit/s for the ambient sound, should be enough (judgement; needs a listen on both phones).** Placed sounds should be mono anyway, because the panner gives them their direction (`src/audio/PositionalAudio.js:58-59`).

A 30-second stereo ambient sound plus six 10-second mono sounds would come to about 600 KB as Opus, against about 1.4 MB as 128 kbit/s MP3 **(computed)**.

## 6. One format or two

**One is enough: Opus in WebM.** It decodes in every Chrome the Redmi Note 8 can run, and in Safari's Web Audio from Safari 15 ([bug 227110][wk-227110], [Safari 15 notes][saf-15]). With the overlap from section 4, how exactly each browser trims stops mattering.

What a single WebM Opus file gives up:

- **iPhones below iOS 15.** On these Web Audio is prefixed (below 14.5) and has no WebM Opus. Covering them would mean shipping MP3 alongside **(judgement)**.
- **iOS 15.0 to 15.3 is not confirmed by Apple.** The evidence is the WebKit change landing before Safari 15, the Safari 15 release note, and a developer's reports from iPadOS 15.4 and later iPhones ([bug 238546][wk-238546]). A real iPhone test closes this.

The alternatives:

- **Ogg Opus alone** loses every iPhone below iOS 18.4, and Chrome below 148.
- **MP3 alone** works on every phone and trims correctly where the LAME header is right. It is about twice the size, and Safari before 27 is unconfirmed (section 4). With the overlap it would still loop cleanly, so it is the fallback if WebM Opus fails on a test iPhone **(judgement)**.
- **AAC alone** is safe in old Safari but has the Safari 27.0 decoding failure ([Safari 27.2 notes][saf-27-2]), the missing end trim before Chrome 151, and no recorded padding at all in raw `.aac` files.

Shipping two formats would mean choosing between them in the page. Since `canPlayType` is unreliable on iPhones (section 3), that means trying one and falling back on a decoding error **(judgement)**.

## 7. Starting after the first touch, and pausing off screen

### The first touch

- **The spec lets browsers keep a new audio context suspended** until the page has sticky activation, meaning the viewer has interacted with it at some point ([spec, "allowed to start"][spec-allowed]). A `resume()` called too early stays pending ([spec][spec-resume]).
- **Chrome** creates an `AudioContext` made before a gesture as "suspended", and it must be resumed "at some time after the user interacted with the page". Starting a node after a gesture also resumes it ([Chrome][chrome-autoplay]). Chrome's media-engagement exception that lets familiar sites autoplay is for "desktop only" ([Chrome][chrome-autoplay]).
- **Safari** starts Web Audio only during transient activation, a short window right after an interaction ([`AudioContext.cpp:93-101`, `:499-515`][wk-context]). Safari 16.4 changed it to need "only … a transient user activation" ([Safari 16.4 notes][saf-16-4]). Starting a source node in that window starts the context too ([`:372-385`][wk-context]). Once the context has started, the rule is removed for that context ([`:508-515`][wk-context]), so later `resume()` calls need no touch.
- **Which touch counts.** In HTML, the events that grant activation are `keydown`, `mousedown`, `pointerdown` for a mouse only, `pointerup` for touch and pen, and `touchend` ([HTML][html-activation], [MDN][mdn-activation]). The finger landing (`touchstart`, or `pointerdown` from a finger) is not one. So if the viewer's first touch is a long push on the joystick, sound can only start when they let go **(judgement, from the list)**. Call `resume()` and start the sounds from a `pointerup` or `touchend` handler, and do the fade-in from there. I could not confirm whether either browser also accepts the finger landing.

### The ringer switch on iPhones

- **By default Web Audio obeys the silent switch.** A WebKit engineer explains that iOS treats Web Audio as "ambient" sound, which can mix with other apps but must obey the mute switch, whereas `<audio>` and `<video>` interrupt other playback and ignore it ([bug 252746][wk-252746]). The default type is `ambient` "and so audio will be muted if the phone is muted" ([bug 237322][wk-237322]).
- **A page can opt out** with `navigator.audioSession.type = "playback"`. The API exists from Safari 16.4 ([Safari 16.4 notes][saf-16-4], [MDN data][bcd-session]). A WebKit engineer gives iOS 17 as when this works for the silent switch ([bug 237322][wk-237322]). The Audio Session draft defines "playback" as audio that should "not mix with other playback audio" ([Audio Session][audio-session]), so the viewer's own music or podcast would stop.
- **"playback" also lets sound carry on in the background.** WebKit skips its usual "entering background" interruption for a page whose audio session is "playback" ([`AudioContext.cpp:781-798`][wk-context]). With that setting, the walkthrough's own pause-when-hidden becomes essential **(judgement, from the code)**.
- Whether to opt out is a product choice, not a format choice: a viewer with their phone on silent may expect silence **(judgement)**.
- On Android I found no primary source saying the ringer or silent mode affects Chrome's Web Audio. Not confirmed.

### Leaving the screen and coming back

- **iPhones** suspend the audio context when Safari goes to the background, "whether playing audio or not", while macOS does so only for silent contexts ([bug 231105][wk-231105], comment 21). Web Audio 1.1 now has an `"interrupted"` state for this ([spec][spec-state]). MDN's data lists it in Safari since 9 and in Chrome since 136 ([MDN data][bcd-bac]). While the context is interrupted, `resume()` is rejected ([spec][spec-resume]).
- **Chrome on Android**: I found no primary source saying Chrome suspends a playing audio context when its page is hidden. Assume it keeps playing.
- **So the walkthrough pauses itself.** On `visibilitychange` to hidden ([MDN][mdn-visibility]), ramp the listener's gain to zero over a fraction of a second, then `suspend()` the context. When the page is visible again, `resume()` and ramp back up. This keeps every sound's position, so loops carry on where they were, and it avoids three.js's `pause()`, which clicks and loses loop positions (section 2) **(judgement)**.
- **If `resume()` fails on return** (on iPhones, because iOS has not yet ended its interruption), listen for `statechange` and try again on the next touch **(judgement, from the spec's rules)**. Chrome needs no new touch, because sticky activation lasts for the page's life ([HTML][html-activation]). Safari needs none either, once the context has started ([`AudioContext.cpp:508-515`][wk-context]).

### Loading last

`AudioLoader` with no loading manager of its own reports to three.js's default one and holds it open until decoding finishes (`src/loaders/AudioLoader.js:64-75`). The walkthrough does not use a loading manager today (no match for `LoadingManager` in `src/`), so this changes nothing yet. If one is added for the loading screen, sound should be given its own manager so it cannot hold the loading screen open **(judgement)**.

## 8. Recommendation

1. **Ship one format: Opus in WebM, 48 kHz.** Mono at 32 to 48 kbit/s for placed sounds, footsteps, doors and the elevator, and stereo at about 64 kbit/s for the ambient sound. FFmpeg's `libopus` encoder writes the delay and end padding the browsers read.
2. **Export every looping sound with 100 ms of overlap at each end**, and loop the middle with `setLoopStart` and `setLoopEnd`. Write the two loop points beside each sound, so the walkthrough does not have to guess them.
3. **Keep loops short**, about 20 to 40 seconds, because decoded sound costs about 11.5 MB per channel per minute whatever the file size **(judgement)**.
4. **Start sound from a `pointerup` or `touchend` handler**: `resume()` the shared context, start the sounds, and fade the listener's gain up.
5. **Pause by suspending the whole context** behind a short fade on `visibilitychange`, not with three.js's `pause()`. Retry `resume()` on the next touch if iOS refuses.
6. **Decide separately** whether to set `navigator.audioSession.type = "playback"` on iPhones (heard despite the silent switch, but stops the viewer's music) or keep the default.
7. **Before building on this, test one looping file on the Redmi Note 8 and on the oldest iPhone available.** Check that it decodes, and listen for the join through earphones. If WebM Opus fails on that iPhone, add MP3 with a LAME header as the second format and keep the overlap.

## 9. Open questions and things I could not verify

- **Nothing was played or measured on a phone.** All decoder behaviour is from source, tests, release notes and bug reports.
- **Chrome 138's handling of WebM Opus** is inferred from the 2026 fix touching only Ogg. It was not run. It matters only if the Redmi Note 8 is still on Android 9.
- **The Redmi Note 8's Android version**: Xiaomi's update history was not found in a primary source. And the "Chrome 138 is the last for Android 8 and 9" notice was seen only as quoted in the press; Google's current page states only "Android 10 and up".
- **iOS 15.0 to 15.3 and WebM Opus in `decodeAudioData`**: no Apple statement. The evidence is the commit dates, the Safari 15 note and a developer's report from later versions.
- **Whether Safari up to 26.x trims MP3 or Ogg** when decoding through `ExtAudioFile`: Apple documents only AAC.
- **Whether Safari 27.0 shipped with the Ogg decoding fix** (314462@main, June 2026). It is not in the Safari 27 release notes, perhaps because the breakage never shipped.
- **How Chrome's copy of FFmpeg handles the start of AAC in `.m4a`**, and whether that copy already has the `iTunSMPB` reading for MP3 seen in FFmpeg's current source.
- **Whether the finger landing (`touchstart`) unlocks sound** in either browser, beyond the HTML list.
- **Whether Chrome on Android keeps Web Audio playing when the page is hidden**, and whether Android's silent mode affects it.
- **The cost of `HRTF` panning** for several placed sounds on the Redmi Note 8 was not measured; `equalpower` is the cheaper model the spec offers.
- **Vorbis and FLAC sizes and quality settings** were not looked up in Xiph sources; the FLAC figure is a rough guess.
- **Bug tracker pages were read through a summarising fetch**, so short quotes from them may not be word for word. Chromium's issue tracker pages could not be read at all; Chromium facts come from commit messages and code.

[spec]: https://www.w3.org/TR/2026/WD-webaudio-1.1-20260922/
[spec-decode]: https://www.w3.org/TR/2026/WD-webaudio-1.1-20260922/#dom-baseaudiocontext-decodeaudiodata
[spec-buffer]: https://www.w3.org/TR/2026/WD-webaudio-1.1-20260922/#AudioBuffer
[spec-looping]: https://www.w3.org/TR/2026/WD-webaudio-1.1-20260922/#looping-AudioBufferSourceNode
[spec-allowed]: https://www.w3.org/TR/2026/WD-webaudio-1.1-20260922/#allowed-to-start
[spec-resume]: https://www.w3.org/TR/2026/WD-webaudio-1.1-20260922/#dom-audiocontext-resume
[spec-state]: https://www.w3.org/TR/2026/WD-webaudio-1.1-20260922/#enumdef-audiocontextstate
[html-activation]: https://html.spec.whatwg.org/multipage/interaction.html#activation-triggering-input-event
[mdn-activation]: https://developer.mozilla.org/en-US/docs/Web/Security/User_activation
[mdn-visibility]: https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event
[audio-session]: https://w3c.github.io/audio-session/
[rfc7845-preskip]: https://www.rfc-editor.org/rfc/rfc7845#section-4.2
[rfc7845-end]: https://www.rfc-editor.org/rfc/rfc7845#section-4.4
[rfc7845-header]: https://www.rfc-editor.org/rfc/rfc7845#section-5.1
[rfc9559-codecdelay]: https://www.rfc-editor.org/rfc/rfc9559#section-5.1.4.1.25
[rfc9559-discard]: https://www.rfc-editor.org/rfc/rfc9559#section-5.1.3.5.7
[vorbis-ogg]: https://xiph.org/vorbis/doc/Vorbis_I_spec.html#x1-132000A.2
[xiph-opus]: https://wiki.xiph.org/Opus_Recommended_Settings
[tn2258]: https://developer.apple.com/library/archive/technotes/tn2258/_index.html
[caniuse-data]: https://github.com/Fyrd/caniuse/tree/main/features-json
[caniuse-opus]: https://caniuse.com/opus
[caniuse-vorbis]: https://caniuse.com/ogg-vorbis
[caniuse-mp3]: https://caniuse.com/mp3
[caniuse-aac]: https://caniuse.com/aac
[caniuse-flac]: https://caniuse.com/flac
[caniuse-wav]: https://caniuse.com/wav
[caniuse-webaudio]: https://caniuse.com/audio-api
[bcd]: https://github.com/mdn/browser-compat-data
[bcd-bac]: https://github.com/mdn/browser-compat-data/blob/main/api/BaseAudioContext.json
[bcd-absn]: https://github.com/mdn/browser-compat-data/blob/main/api/AudioBufferSourceNode.json
[bcd-session]: https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json
[chrome-autoplay]: https://developer.chrome.com/blog/autoplay#web_audio
[chrome-reqs]: https://support.google.com/chrome/answer/95346?co=GENIE.Platform%3DAndroid
[cr-milestones]: https://chromiumdash.appspot.com/fetch_milestones
[cr-android-stable]: https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Android&num=1
[cr-afr]: https://github.com/chromium/chromium/blob/fff931ec00a00ef3acdc5611f77d5d7e783bb0a7/media/filters/audio_file_reader.cc
[cr-decoder]: https://github.com/chromium/chromium/blob/fff931ec00a00ef3acdc5611f77d5d7e783bb0a7/content/renderer/media/audio_decoder.cc
[cr-switches]: https://github.com/chromium/chromium/blob/fff931ec00a00ef3acdc5611f77d5d7e783bb0a7/media/base/media_switches.cc
[cr-ogg-fix]: https://github.com/chromium/chromium/commit/9abfc1f7a9e2b397dd4bc5508cdad3313bd5f7f7
[cr-aac-fix]: https://github.com/chromium/chromium/commit/a708cddb592974008aa4b2e5877217ffc242c9d3
[cr-opus-direct]: https://github.com/chromium/chromium/commit/1d805622e3226eff40e3b30bb072a059ebc29bcc
[cr-symphonia]: https://github.com/chromium/chromium/commit/0a0d86eaa229967d771d0d1c50f2420e70db62c3
[ff-mp3]: https://github.com/FFmpeg/FFmpeg/blob/744588782d47071a64b963edfbeedb052ee9440c/libavformat/mp3dec.c
[ff-libopus]: https://github.com/FFmpeg/FFmpeg/blob/744588782d47071a64b963edfbeedb052ee9440c/libavcodec/libopusenc.c
[ff-encode]: https://github.com/FFmpeg/FFmpeg/blob/744588782d47071a64b963edfbeedb052ee9440c/libavcodec/encode.c
[ff-mkv]: https://github.com/FFmpeg/FFmpeg/blob/744588782d47071a64b963edfbeedb052ee9440c/libavformat/matroskaenc.c
[wk-reader]: https://github.com/WebKit/WebKit/blob/cf30450ee4aba458dcdb95593ce674d0943bf2e7/Source/WebCore/platform/audio/cocoa/AudioFileReaderCocoa.mm
[wk-reader-old]: https://github.com/WebKit/WebKit/blob/37a89f9dc73d9e5ca301c08eb3c24a16010738cc/Source/WebCore/platform/audio/cocoa/AudioFileReaderCocoa.cpp
[wk-context]: https://github.com/WebKit/WebKit/blob/e427188d73fb165e49a4aade8c172b47ea6fbe02/Source/WebCore/Modules/webaudio/AudioContext.cpp
[wk-309140]: https://commits.webkit.org/309140@main
[wk-ogg-regression]: https://commits.webkit.org/314462@main
[wk-228140]: https://github.com/WebKit/WebKit/commit/93d6788bf2
[wk-test-webm-opus]: https://github.com/WebKit/WebKit/blob/cf30450ee4aba458dcdb95593ce674d0943bf2e7/LayoutTests/webaudio/decode-audio-data-webm-opus.html
[wk-test-ogg-opus]: https://github.com/WebKit/WebKit/blob/cf30450ee4aba458dcdb95593ce674d0943bf2e7/LayoutTests/webaudio/decode-audio-data-ogg-opus.html
[wk-test-mp3]: https://github.com/WebKit/WebKit/blob/cf30450ee4aba458dcdb95593ce674d0943bf2e7/LayoutTests/webaudio/decode-audio-data-mp3.html
[wk-test-aac]: https://github.com/WebKit/WebKit/blob/cf30450ee4aba458dcdb95593ce674d0943bf2e7/LayoutTests/webaudio/decode-audio-data-aac.html
[wk-226922]: https://bugs.webkit.org/show_bug.cgi?id=226922
[wk-227110]: https://bugs.webkit.org/show_bug.cgi?id=227110
[wk-238546]: https://bugs.webkit.org/show_bug.cgi?id=238546
[wk-231105]: https://bugs.webkit.org/show_bug.cgi?id=231105
[wk-237322]: https://bugs.webkit.org/show_bug.cgi?id=237322
[wk-252746]: https://bugs.webkit.org/show_bug.cgi?id=252746
[saf-15]: https://developer.apple.com/documentation/safari-release-notes/safari-15-release-notes
[saf-16-4]: https://developer.apple.com/documentation/safari-release-notes/safari-16_4-release-notes
[saf-17-4]: https://developer.apple.com/documentation/safari-release-notes/safari-17_4-release-notes
[saf-18-4]: https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes
[saf-27]: https://developer.apple.com/documentation/safari-release-notes/safari-27-release-notes
[saf-27-2]: https://developer.apple.com/documentation/safari-release-notes/safari-27_2-release-notes
