import React from "react";
import { TextToSpeechProps, TextToSpeechState } from "./interface";
import { Trans } from "react-i18next";
import { speedList } from "../../constants/dropdownList";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import {
  checkPlugin,
  getAllVoices,
  handleContextMenu,
  sleep,
  splitSentences,
  WEBSITE_URL,
} from "../../utils/common";
import { getSelection } from "../../utils/reader/mouseEvent";
import { isElectron } from "react-device-detect";
import toast from "react-hot-toast";
import TTSUtil from "../../utils/reader/ttsUtil";
import "./textToSpeech.css";
import { openExternalUrl } from "../../utils/common";
import DatabaseService from "../../utils/storage/databaseService";
declare var window: any;
declare var global: any;

interface ServerVoice {
  id: string;
  name: string;
  locale?: string;
}
class TextToSpeech extends React.Component<
  TextToSpeechProps,
  TextToSpeechState
> {
  nodeList: string[];
  voices: any;
  customVoices: any;
  nativeVoices: any;
  serverVoices: ServerVoice[];
  activeAudio: HTMLAudioElement | null;
  useServerVoices: boolean;
  activeAudioUrl: string | null;
  serverAudioCache: Map<number, string>;
  serverAudioLoading: Map<number, Promise<string | null>>;
  constructor(props: TextToSpeechProps) {
    super(props);
    this.state = {
      isSupported: false,
      isAudioOn: false,
      isAddNew: false,
      isHighlightEnabled:
        ConfigService.getReaderConfig("ttsHighlight") !== "no",
      selectedServerVoice:
        ConfigService.getReaderConfig("ttsServerVoice") || "",
      isFetchingVoices: false,
    };
    this.nodeList = [];
    this.voices = [];
    this.customVoices = [];
    this.nativeVoices = [];
    this.serverVoices = [];
    this.activeAudio = null;
    this.useServerVoices = false;
    this.activeAudioUrl = null;
    this.serverAudioCache = new Map();
    this.serverAudioLoading = new Map();
  }
  fetchServerVoices = async () => {
    this.setState({ isFetchingVoices: true });
    try {
      const response = await fetch("/api/tts/voices");
      if (!response.ok) {
        throw new Error("Failed to load voices");
      }
      const data = await response.json();
      if (data.success && Array.isArray(data.voices)) {
        this.serverVoices = data.voices;
        this.useServerVoices = this.serverVoices.length > 0;
        let selectedVoice = this.state.selectedServerVoice;
        if (
          (!selectedVoice ||
            !this.serverVoices.find((voice) => voice.id === selectedVoice)) &&
          this.serverVoices.length > 0
        ) {
          selectedVoice = this.serverVoices[0].id;
          ConfigService.setReaderConfig("ttsServerVoice", selectedVoice);
        }
        this.setState({ selectedServerVoice: selectedVoice });
      } else {
        this.useServerVoices = false;
      }
    } catch (error) {
      console.error("Failed to fetch TTS voices", error);
      this.useServerVoices = false;
    } finally {
      this.setState({ isFetchingVoices: false });
    }
  };
  componentWillUnmount(): void {
    this.cleanupActiveAudio();
    window.speechSynthesis && window.speechSynthesis.cancel();
  }
  async componentDidMount() {
    if ("speechSynthesis" in window) {
      this.setState({ isSupported: true });
    }
    if (this.state.isAudioOn) {
      window.speechSynthesis && window.speechSynthesis.cancel();
      this.setState({ isAudioOn: false });
      this.nodeList = [];
    }
    const setSpeech = () => {
      return new Promise((resolve) => {
        let synth = window.speechSynthesis;
        let id;
        if (synth) {
          id = setInterval(() => {
            if (synth.getVoices().length !== 0) {
              resolve(synth.getVoices());
              clearInterval(id);
            } else {
              this.setState({ isSupported: false });
            }
          }, 10);
        }
      });
    };
    this.nativeVoices = await setSpeech();
    if (!isElectron) {
      this.fetchServerVoices();
    }
  }
  handleChangeAudio = () => {
    this.setState({ isAddNew: false });
    if (this.state.isAudioOn) {
      window.speechSynthesis && window.speechSynthesis.cancel();
      TTSUtil.pauseAudio();
      this.cleanupActiveAudio();
      this.setState({ isAudioOn: false });
      this.nodeList = [];
      this.resetServerAudioCache();
    } else {
      if (
        !isElectron &&
        this.serverVoices.length === 0 &&
        this.state.isFetchingVoices
      ) {
        toast(this.props.t("Loading voices, please try again"));
        return;
      }
      if (isElectron) {
        this.customVoices = TTSUtil.getVoiceList(this.props.plugins);
        this.voices = [...this.nativeVoices, ...this.customVoices];
        this.useServerVoices = false;
      } else {
        if (this.serverVoices.length > 0) {
          this.voices = this.serverVoices;
          this.useServerVoices = true;
        } else {
          this.voices = this.nativeVoices;
          this.useServerVoices = false;
        }
      }
      if (
        !this.useServerVoices &&
        this.voices.length === 0 &&
        getAllVoices(this.props.plugins).length === 0
      ) {
        this.setState({ isAddNew: true });
        return;
      }
      this.resetServerAudioCache();
      this.handleStartSpeech();
    }
  };
  cleanupActiveAudio = () => {
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio = null;
    }
    if (this.activeAudioUrl) {
      URL.revokeObjectURL(this.activeAudioUrl);
      this.activeAudioUrl = null;
    }
  };
  resetServerAudioCache = () => {
    this.serverAudioLoading.clear();
    this.serverAudioCache.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    this.serverAudioCache.clear();
    this.activeAudioUrl = null;
  };
  handleStartSpeech = () => {
    this.setState({ isAudioOn: true }, () => {
      this.handleAudio();
    });
  };
  handleAudio = async () => {
    this.resetServerAudioCache();
    this.nodeList = await this.handleGetText();
    if (this.useServerVoices && this.serverVoices.length > 0) {
      await this.prefetchServerAudio(0, this.getCurrentSpeed());
      await this.handleSystemRead(0);
      return;
    }
    let voiceIndex = parseInt(ConfigService.getReaderConfig("voiceIndex")) || 0;
    if (
      voiceIndex > this.nativeVoices.length - 1 &&
      getAllVoices(this.props.plugins).length > 0
    ) {
      await this.handleCustomRead();
    } else {
      await this.handleSystemRead(0);
    }
  };
  handleGetText = async () => {
    if (ConfigService.getReaderConfig("isSliding") === "yes") {
      await sleep(1000);
    }
    let nodeTextList = (await this.props.htmlBook.rendition.audioText()).filter(
      (item: string) => item && item.trim()
    );
    this.nodeList = nodeTextList;
    if (
      this.props.currentBook.format === "PDF" &&
      ConfigService.getReaderConfig("isConvertPDF") !== "yes"
    ) {
    } else {
      let rawNodeList = nodeTextList.map((text) => {
        return splitSentences(text);
      });
      this.nodeList = rawNodeList.flat();
    }

    const selectionText = getSelection(this.props.currentBook.format);
    if (selectionText) {
      const normalizedSelection = this.normalizeSentence(selectionText);
      const startIndex = this.nodeList.findIndex((sentence) =>
        this.normalizeSentence(sentence).includes(normalizedSelection)
      );
      if (startIndex > 0) {
        this.nodeList = this.nodeList.slice(startIndex);
      }
    }

    if (this.nodeList.length === 0) {
      if (
        this.props.currentBook.format === "PDF" &&
        ConfigService.getReaderConfig("isConvertPDF") !== "yes"
      ) {
        let currentPosition = this.props.htmlBook.rendition.getPosition();
        await this.props.htmlBook.rendition.goToChapterIndex(
          parseInt(currentPosition.chapterDocIndex) +
            (this.props.readerMode === "double" ? 2 : 1)
        );
      } else {
        await this.props.htmlBook.rendition.next();
      }

      this.nodeList = await this.handleGetText();
    }
    return this.nodeList;
  };
  normalizeSentence = (text: string) => {
    return text ? text.replace(/\s+/g, " ").trim().toLowerCase() : "";
  };
  sanitizeNodeText = (text: string) => {
    return text
      .replace(/\s\s/g, " ")
      .replace(/\r/g, " ")
      .replace(/\n/g, " ")
      .replace(/\t/g, " ")
      .replace(/&/g, " ")
      .replace(/\f/g, " ");
  };
  getCurrentSpeed = () => {
    let speed = parseFloat(
      ConfigService.getReaderConfig("voiceSpeed") || "1"
    );
    if (isNaN(speed)) {
      speed = 1;
    }
    speed = Math.min(2, Math.max(0.5, speed));
    return speed;
  };
  handleServerVoiceChange = (voiceId: string) => {
    ConfigService.setReaderConfig("ttsServerVoice", voiceId);
    this.setState({ selectedServerVoice: voiceId });
  };
  toggleHighlight = () => {
    const next = !this.state.isHighlightEnabled;
    this.setState({ isHighlightEnabled: next });
    ConfigService.setReaderConfig("ttsHighlight", next ? "yes" : "no");
  };
  async handleCustomRead() {
    let voiceIndex = parseInt(ConfigService.getReaderConfig("voiceIndex")) || 0;
    let speed = this.getCurrentSpeed();
    TTSUtil.setAudioPaths();
    await TTSUtil.cacheAudio(
      [this.nodeList[0]],
      voiceIndex - this.nativeVoices.length,
      speed * 100 - 100,
      this.props.plugins
    );

    setTimeout(async () => {
      await TTSUtil.cacheAudio(
        this.nodeList.slice(1),
        voiceIndex - this.nativeVoices.length,
        speed * 100 - 100,
        this.props.plugins
      );
    }, 1);

    for (let index = 0; index < this.nodeList.length; index++) {
      let currentText = this.nodeList[index];
      let style = this.state.isHighlightEnabled
        ? "background: #f3a6a68c;"
        : "";
      this.props.htmlBook.rendition.highlightAudioNode(currentText, style);

      if (index > TTSUtil.getAudioPaths().length - 1) {
        while (true) {
          if (index < TTSUtil.getAudioPaths().length - 1) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      let res = await this.handleSpeech(
        index,
        parseInt(ConfigService.getReaderConfig("voiceIndex")) || 0,
        this.getCurrentSpeed()
      );
      let visibleTextList = await this.props.htmlBook.rendition.visibleText();
      let lastVisibleTextList = visibleTextList;
      if (
        this.props.currentBook.format === "PDF" &&
        ConfigService.getReaderConfig("isConvertPDF") !== "yes"
      ) {
      } else {
        lastVisibleTextList = splitSentences(
          visibleTextList[visibleTextList.length - 1]
        );
      }

      if (
        this.nodeList[index] ===
        lastVisibleTextList[lastVisibleTextList.length - 1]
      ) {
        if (
          this.props.currentBook.format === "PDF" &&
          ConfigService.getReaderConfig("isConvertPDF") !== "yes"
        ) {
          let currentPosition = this.props.htmlBook.rendition.getPosition();
          await this.props.htmlBook.rendition.goToChapterIndex(
            parseInt(currentPosition.chapterDocIndex) +
              (this.props.readerMode === "double" ? 2 : 1)
          );
        } else {
          await this.props.htmlBook.rendition.next();
        }
      }
      if (res === "end") {
        break;
      }
    }
    if (this.state.isAudioOn && this.props.isReading) {
      isElectron &&
        (await window.require("electron").ipcRenderer.invoke("clear-tts"));
      let position = this.props.htmlBook.rendition.getPosition();
      ConfigService.setObjectConfig(
        this.props.currentBook.key,
        position,
        "recordLocation"
      );
      this.nodeList = [];
      await this.handleAudio();
    }
  }
  async handleSystemRead(index) {
    if (index >= this.nodeList.length) {
      this.nodeList = [];
      await this.handleAudio();
      return;
    }
    let currentText = this.nodeList[index];
    let style = this.state.isHighlightEnabled
      ? "background: #f3a6a68c;"
      : "";
    this.props.htmlBook.rendition.highlightAudioNode(currentText, style);

    let res = await this.handleSystemSpeech(
      index,
      parseInt(ConfigService.getReaderConfig("voiceIndex")) || 0,
      this.getCurrentSpeed()
    );

    if (res === "start") {
      let visibleTextList = await this.props.htmlBook.rendition.visibleText();
      let lastVisibleTextList = visibleTextList;
      if (
        this.props.currentBook.format === "PDF" &&
        ConfigService.getReaderConfig("isConvertPDF") !== "yes"
      ) {
      } else {
        lastVisibleTextList = splitSentences(
          visibleTextList[visibleTextList.length - 1]
        );
      }
      if (
        this.nodeList[index] ===
        lastVisibleTextList[lastVisibleTextList.length - 1]
      ) {
        if (
          this.props.currentBook.format === "PDF" &&
          ConfigService.getReaderConfig("isConvertPDF") !== "yes"
        ) {
          let currentPosition = this.props.htmlBook.rendition.getPosition();
          await this.props.htmlBook.rendition.goToChapterIndex(
            parseInt(currentPosition.chapterDocIndex) +
              (this.props.readerMode === "double" ? 2 : 1)
          );
        } else {
          await this.props.htmlBook.rendition.next();
        }
      }
      if (
        this.state.isAudioOn &&
        this.props.isReading &&
        index === this.nodeList.length
      ) {
        let position = this.props.htmlBook.rendition.getPosition();
        ConfigService.setObjectConfig(
          this.props.currentBook.key,
          position,
          "recordLocation"
        );
        this.nodeList = [];
        await this.handleAudio();
        return;
      }
      index++;
      await this.handleSystemRead(index);
    } else if (res === "end") {
      return;
    }
  }
  handleSpeech = async (index: number, _voiceIndex: number, _speed: number) => {
    return new Promise<string>(async (resolve) => {
      let res = await TTSUtil.readAloud(index);
      if (res === "loaderror") {
        resolve("start");
      } else {
        let player = TTSUtil.getPlayer();
        player.on("end", async () => {
          if (!(this.state.isAudioOn && this.props.isReading)) {
            resolve("end");
          }
          resolve("start");
        });
      }
    });
  };
  handleSystemSpeech = async (
    index: number,
    voiceIndex: number,
    speed: number
  ) => {
    if (this.useServerVoices) {
      return this.handleServerSpeech(index, speed);
    }
    return new Promise<string>(async (resolve) => {
      var msg = new SpeechSynthesisUtterance();
      msg.text = this.sanitizeNodeText(this.nodeList[index]);

      msg.voice = this.nativeVoices[voiceIndex];
      msg.rate = speed;
      window.speechSynthesis && window.speechSynthesis.cancel();
      window.speechSynthesis.speak(msg);
      msg.onerror = (err) => {
        console.error(err);
        resolve("end");
      };

      msg.onend = async () => {
        if (!(this.state.isAudioOn && this.props.isReading)) {
          resolve("end");
        }
        resolve("start");
      };
    });
  };
  handleServerSpeech = async (index: number, speed: number) => {
    return new Promise<string>(async (resolve) => {
      try {
        const audioUrl = await this.prefetchServerAudio(index, speed);
        if (!audioUrl) {
          resolve("end");
          return;
        }
        this.cleanupActiveAudio();
        const audio = new Audio(audioUrl);
        audio.onended = () => {
          this.cleanupActiveAudio();
          if (!(this.state.isAudioOn && this.props.isReading)) {
            resolve("end");
          } else {
            resolve("start");
          }
        };
        audio.onerror = (event) => {
          console.error("TTS playback error", event);
          this.cleanupActiveAudio();
          resolve("end");
        };
        this.activeAudio = audio;
        this.activeAudioUrl = audioUrl;
        const playPromise = audio.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch((error) => {
            console.error("Unable to start audio", error);
            this.cleanupActiveAudio();
            resolve("end");
          });
        }
        // Preload next sentence while current audio plays
        this.prefetchServerAudio(index + 1, speed);
      } catch (error) {
        console.error("Failed to play TTS audio", error);
        resolve("end");
      }
    });
  };
  prefetchServerAudio = async (index: number, speed: number) => {
    if (index < 0 || index >= this.nodeList.length) {
      return null;
    }
    if (this.serverAudioCache.has(index)) {
      return this.serverAudioCache.get(index) as string;
    }
    if (this.serverAudioLoading.has(index)) {
      return this.serverAudioLoading.get(index);
    }

    const loadPromise = (async () => {
      try {
        const url = await this.requestServerAudio(
          this.sanitizeNodeText(this.nodeList[index]),
          speed
        );
        if (url) {
          this.serverAudioCache.set(index, url);
        }
        return url;
      } finally {
        this.serverAudioLoading.delete(index);
      }
    })();

    this.serverAudioLoading.set(index, loadPromise);
    return loadPromise;
  };
  requestServerAudio = async (text: string, speed: number) => {
    const voiceId =
      this.state.selectedServerVoice || this.serverVoices[0]?.id || "";
    if (!voiceId) {
      toast.error(this.props.t("No voice selected"));
      return null;
    }
    try {
      const response = await fetch("/api/tts/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text, voice: voiceId, speed }),
      });
      if (!response.ok) {
        throw new Error("TTS endpoint error");
      }
      const data = await response.json();
      if (!data.success || !data.audio) {
        throw new Error(data.message || "TTS request failed");
      }
      const byteCharacters = atob(data.audio);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], {
        type: data.mimeType || "audio/wav",
      });
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error(error);
      toast.error(this.props.t("Unable to generate speech"));
      return null;
    }
  };
  render() {
    const showingServerVoices =
      !isElectron && this.useServerVoices && this.serverVoices.length > 0;
    const voiceSelectValue = showingServerVoices
      ? this.state.selectedServerVoice
      : ConfigService.getReaderConfig("voiceIndex") || "0";
    return (
      <>
        {
          <>
            <div className="single-control-switch-container">
              <span className="single-control-switch-title">
                <Trans>Turn on text-to-speech</Trans>
              </span>

              <span
                className="single-control-switch"
                onClick={() => {
                  this.handleChangeAudio();
                }}
                style={this.state.isAudioOn ? {} : { opacity: 0.6 }}
              >
                <span
                  className="single-control-button"
                  style={
                    this.state.isAudioOn
                      ? {
                          transform: "translateX(20px)",
                          transition: "transform 0.5s ease",
                        }
                      : {
                          transform: "translateX(0px)",
                          transition: "transform 0.5s ease",
                        }
                  }
                ></span>
              </span>
            </div>
            {this.state.isAudioOn && (
              <div
                className="setting-dialog-new-title"
                style={{
                  marginLeft: "20px",
                  width: "88%",
                  marginTop: "20px",
                  fontWeight: 500,
                }}
              >
                <Trans>Voice</Trans>
                <select
                  name=""
                  className="lang-setting-dropdown"
                  id="text-speech-voice"
                  value={voiceSelectValue}
                  onChange={(event) => {
                    if (showingServerVoices) {
                      this.handleServerVoiceChange(event.target.value);
                      toast(this.props.t("Take effect at next startup"));
                      return;
                    }
                    if (event.target.value === this.voices.length - 1 + "") {
                      window.speechSynthesis && window.speechSynthesis.cancel();
                      TTSUtil.pauseAudio();
                      this.setState({ isAddNew: true, isAudioOn: false });
                    } else {
                      ConfigService.setReaderConfig(
                        "voiceIndex",
                        event.target.value
                      );

                      toast(this.props.t("Take effect at next startup"));
                    }
                  }}
                >
                  {showingServerVoices
                    ? this.serverVoices.map((item) => (
                        <option
                          value={item.id}
                          key={item.id}
                          className="lang-setting-option"
                        >
                          {this.props.t(item.name)}
                        </option>
                      ))
                    : this.voices.map((item, index: number) => {
                        return (
                          <option
                            value={index}
                            key={item.name}
                            className="lang-setting-option"
                          >
                            {this.props.t(item.displayName || item.name)}
                          </option>
                        );
                      })}
                </select>
              </div>
            )}
            {this.state.isAudioOn && !this.state.isAddNew && (
              <div
                className="setting-dialog-new-title"
                style={{ marginLeft: "20px", width: "88%", fontWeight: 500 }}
              >
                <Trans>Speed</Trans>
                <select
                  name=""
                  id="text-speech-speed"
                  className="lang-setting-dropdown"
                  value={
                    ConfigService.getReaderConfig("voiceSpeed") || "1"
                  }
                  onChange={(event) => {
                    ConfigService.setReaderConfig(
                      "voiceSpeed",
                      event.target.value
                    );

                    toast(this.props.t("Take effect in a while"));
                  }}
                >
                  {speedList.option.map((item) => (
                    <option
                      value={item.value}
                      className="lang-setting-option"
                      key={item.value}
                    >
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {this.state.isAudioOn && !this.state.isAddNew && (
              <div className="single-control-switch-container">
                <span className="single-control-switch-title">
                  <Trans>Highlight sentence while reading</Trans>
                </span>

                <span
                  className="single-control-switch"
                  onClick={() => {
                    this.toggleHighlight();
                  }}
                  style={
                    this.state.isHighlightEnabled ? {} : { opacity: 0.6 }
                  }
                >
                  <span
                    className="single-control-button"
                    style={
                      this.state.isHighlightEnabled
                        ? {
                            transform: "translateX(20px)",
                            transition: "transform 0.5s ease",
                          }
                        : {
                            transform: "translateX(0px)",
                            transition: "transform 0.5s ease",
                          }
                    }
                  ></span>
                </span>
              </div>
            )}
            {this.state.isAddNew && (
              <div
                className="voice-add-new-container"
                style={{ marginLeft: "20px", width: "88%", fontWeight: 500 }}
              >
                <textarea
                  name="url"
                  placeholder={this.props.t(
                    "Paste the code of the plugin here, check out document to learn how to get more plugins"
                  )}
                  id="voice-add-content-box"
                  className="voice-add-content-box"
                  onContextMenu={() => {
                    handleContextMenu("voice-add-content-box");
                  }}
                  style={{ marginBottom: "10px" }}
                />

                <div
                  className="voice-add-confirm"
                  onClick={async () => {
                    let value: string = (
                      document.querySelector(
                        "#voice-add-content-box"
                      ) as HTMLTextAreaElement
                    ).value;
                    if (value) {
                      let plugin = JSON.parse(value);
                      plugin.key = plugin.identifier;
                      if (!(await checkPlugin(plugin))) {
                        toast.error(this.props.t("Plugin verification failed"));
                        return;
                      }
                      if (
                        plugin.type === "voice" &&
                        plugin.voiceList.length === 0
                      ) {
                        let voiceFunc = plugin.script;
                        // eslint-disable-next-line no-eval
                        eval(voiceFunc);
                        plugin.voiceList = await global.getTTSVoice(
                          plugin.config
                        );
                      }
                      if (
                        this.props.plugins.find(
                          (item) => item.key === plugin.key
                        )
                      ) {
                        await DatabaseService.updateRecord(plugin, "plugins");
                      } else {
                        await DatabaseService.saveRecord(plugin, "plugins");
                      }
                      this.props.handleFetchPlugins();
                      toast.success(this.props.t("Addition successful"));
                    }
                    this.setState({ isAddNew: false });
                  }}
                >
                  <Trans>Confirm</Trans>
                </div>
                <div className="voice-add-button-container">
                  <div
                    className="voice-add-cancel"
                    onClick={() => {
                      this.setState({ isAddNew: false });
                    }}
                  >
                    <Trans>Cancel</Trans>
                  </div>
                  <div
                    className="voice-add-cancel"
                    style={{ marginRight: "10px" }}
                    onClick={() => {
                      if (
                        ConfigService.getReaderConfig("lang") &&
                        ConfigService.getReaderConfig("lang").startsWith("zh")
                      ) {
                        openExternalUrl(WEBSITE_URL + "/zh/plugin");
                      } else {
                        openExternalUrl(WEBSITE_URL + "/en/plugin");
                      }
                    }}
                  >
                    <Trans>Document</Trans>
                  </div>
                </div>
              </div>
            )}
          </>
        }
      </>
    );
  }
}

export default TextToSpeech;
