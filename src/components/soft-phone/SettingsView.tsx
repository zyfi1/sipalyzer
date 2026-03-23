import { useRef, useEffect, useCallback, useState } from "react";
import { useSoftphoneStore } from "@/stores/softphoneStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AppDropdown } from "@/components/ui/app-dropdown";
import { Mic, Volume2, RotateCcw, RefreshCw, Radio, Play, StopIcon } from "@/lib/icons";
import {
  ParticleNebula,
  WaveformRibbon,
  FrequencyAurora,
  HeartbeatEKG,
  TerrainRange,
  BarSpectrum,
  DigitalRain,
  VISUALIZER_OPTIONS,
  type VisualizerId,
} from "./visualizers";
import { RINGTONE_PRESETS, createRingtoneGraph } from "./useIncomingRingtone";

const MIC_LEVEL_SNAP_PERCENT = 100;
const MIC_LEVEL_SNAP_WINDOW = 4;

function snapMicLevelPercent(rawPercent: number): number {
  if (Math.abs(rawPercent - MIC_LEVEL_SNAP_PERCENT) <= MIC_LEVEL_SNAP_WINDOW) {
    return MIC_LEVEL_SNAP_PERCENT;
  }
  return rawPercent;
}

export function SettingsView() {
  const {
    audioInputDeviceId,
    audioOutputDeviceId,
    audioInputLevel,
    audioInputDevices,
    audioOutputDevices,
    setAudioInputDevice,
    setAudioOutputDevice,
    setAudioInputLevel,
    fetchAudioDevices,
    jitterBufferMinMs,
    jitterBufferMaxMs,
    setJitterBuffer,
    mohPreset,
    dndEnabled,
    autoAnswerEnabled,
    autoAnswerDelayMs,
    ringtonePreset,
    ringbackEnabled,
    callWaitingEnabled,
    maxSimultaneousCalls,
    dtmfMode,
    dtmfPayloadType,
    autoRecordEnabled,
    recordingFormat,
    recordingStereo,
    clickToDialEnabled,
    autoOpenOnIncoming,
    forwardAllEnabled,
    forwardAllTarget,
    forwardBusyEnabled,
    forwardBusyTarget,
    forwardNoAnswerEnabled,
    forwardNoAnswerTarget,
    forwardNoAnswerTimeout,
    vadEnabled,
    plcEnabled,
    srtpEnabled,
    srtpMode,
    visualizer,
    showVisualizer,
    updateSettings,
  } = useSoftphoneStore();
  const mediaPorts = useSettingsStore((s) => s.mediaPorts);
  const setMediaPorts = useSettingsStore((s) => s.setMediaPorts);
  const [mediaRangeLowDraft, setMediaRangeLowDraft] = useState(String(mediaPorts.rangeLow));
  const [mediaRangeHighDraft, setMediaRangeHighDraft] = useState(String(mediaPorts.rangeHigh));

  useEffect(() => {
    setMediaRangeLowDraft(String(mediaPorts.rangeLow));
    setMediaRangeHighDraft(String(mediaPorts.rangeHigh));
  }, [mediaPorts.rangeLow, mediaPorts.rangeHigh]);

  const applyMediaRange = useCallback(() => {
    const low = Number(mediaRangeLowDraft);
    const high = Number(mediaRangeHighDraft);
    const validLow = Number.isInteger(low) && low >= 1024 && low <= 65535;
    const validHigh = Number.isInteger(high) && high >= 1024 && high <= 65535;
    if (!validLow || !validHigh || low >= high) {
      setMediaRangeLowDraft(String(mediaPorts.rangeLow));
      setMediaRangeHighDraft(String(mediaPorts.rangeHigh));
      return;
    }
    setMediaPorts({ rangeLow: low, rangeHigh: high });
  }, [
    mediaRangeLowDraft,
    mediaRangeHighDraft,
    mediaPorts.rangeLow,
    mediaPorts.rangeHigh,
    setMediaPorts,
  ]);

  const handleReset = () => {
    updateSettings({
      dndEnabled: false,
      autoAnswerEnabled: false,
      autoAnswerDelayMs: 0,
      ringtonePreset: "default",
      ringbackEnabled: true,
      callWaitingEnabled: true,
      maxSimultaneousCalls: 2,
      dtmfMode: "rfc2833",
      dtmfPayloadType: 101,
      autoRecordEnabled: false,
      recordingFormat: "wav",
      recordingStereo: true,
      clickToDialEnabled: true,
      autoOpenOnIncoming: true,
      forwardAllEnabled: false,
      forwardAllTarget: "",
      forwardBusyEnabled: false,
      forwardBusyTarget: "",
      forwardNoAnswerEnabled: false,
      forwardNoAnswerTarget: "",
      forwardNoAnswerTimeout: 20,
      mohPreset: "system",
      vadEnabled: false,
      plcEnabled: true,
      srtpEnabled: false,
      srtpMode: "disabled",
      visualizer: "nebula",
      showVisualizer: true,
    });
    setJitterBuffer(50, 200);
    setAudioInputLevel(1.0);
    setAudioInputDevice(null);
    setAudioOutputDevice(null);
  };

  const micGainPercent = Math.max(0, Math.min(200, Math.round(audioInputLevel * 100)));

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-8">
      {/* Section 1: Audio Devices */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Audio Devices</h3>
        <div className="rounded-lg shadow-card divide-y divide-border/30">
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="audio-input" className="cursor-pointer">
                Microphone
              </Label>
              <p className="text-xs text-muted-foreground">Audio input device</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Mic className="h-4 w-4 text-muted-foreground" />
              <AppDropdown
                id="audio-input"
                value={audioInputDeviceId ?? "default"}
                onValueChange={(value) => setAudioInputDevice(value === "default" ? null : value)}
                className="w-[200px]"
                options={[
                  { value: "default", label: "System default" },
                  ...audioInputDevices.map((device) => ({
                    value: device.id,
                    label: device.name,
                  })),
                ]}
              />
            </div>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="audio-output" className="cursor-pointer">
                Speaker
              </Label>
              <p className="text-xs text-muted-foreground">Audio output device</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Volume2 className="h-4 w-4 text-muted-foreground" />
              <AppDropdown
                id="audio-output"
                value={audioOutputDeviceId ?? "default"}
                onValueChange={(value) => setAudioOutputDevice(value === "default" ? null : value)}
                className="w-[200px]"
                options={[
                  { value: "default", label: "System default" },
                  ...audioOutputDevices.map((device) => ({
                    value: device.id,
                    label: device.name,
                  })),
                ]}
              />
            </div>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="audio-gain" className="cursor-pointer">
                Microphone level
              </Label>
              <p className="text-xs text-muted-foreground">System-style input level (0%-200%)</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-[120px]">
                <div className="relative">
                  <Input
                    id="audio-gain"
                    type="range"
                    min="0"
                    max="200"
                    step="1"
                    value={micGainPercent}
                    onChange={(e) => {
                      const rawPercent = parseInt(e.target.value, 10);
                      const snappedPercent = snapMicLevelPercent(rawPercent);
                      setAudioInputLevel(snappedPercent / 100);
                    }}
                    className="relative z-10 w-[120px]"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-border/70"
                  />
                </div>
                <div className="relative mt-0.5 h-3 text-3xs font-mono tabular-nums text-muted-foreground/70">
                  <span className="absolute left-0">0</span>
                  <span className="absolute left-1/2 -translate-x-1/2 text-foreground/80">100</span>
                  <span className="absolute right-0">200</span>
                </div>
              </div>
              <span className="text-sm text-muted-foreground w-14 text-right tabular-nums">
                {`${micGainPercent}%`}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label>Refresh devices</Label>
              <p className="text-xs text-muted-foreground">Reload available audio devices</p>
            </div>
            <Button variant="neutral" size="sm" onClick={() => fetchAudioDevices()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Section 1b: Audio Visualization */}
      <VisualizerPreviewSection
        value={visualizer}
        showVisualizer={showVisualizer}
        onChange={(v) => updateSettings({ visualizer: v })}
        onToggleShow={(v) => updateSettings({ showVisualizer: v })}
      />

      {/* Section 3: Call Behavior */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Call Behavior</h3>
        <div className="rounded-lg shadow-card divide-y divide-border/30">
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label htmlFor="dnd" className="cursor-pointer">
                Do not disturb
              </Label>
              <p className="text-xs text-muted-foreground">Block incoming calls</p>
            </div>
            <Checkbox
              id="dnd"
              checked={dndEnabled}
              onCheckedChange={(v) => updateSettings({ dndEnabled: v === true })}
            />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label htmlFor="auto-answer" className="cursor-pointer">
                Auto-answer
              </Label>
              <p className="text-xs text-muted-foreground">Automatically answer incoming calls</p>
            </div>
            <Checkbox
              id="auto-answer"
              checked={autoAnswerEnabled}
              onCheckedChange={(v) => updateSettings({ autoAnswerEnabled: v === true })}
            />
          </div>
          {autoAnswerEnabled && (
            <div className="flex items-center justify-between p-4">
              <div className="space-y-0.5 flex-1 min-w-0">
                <Label htmlFor="auto-answer-delay" className="cursor-pointer">
                  Auto-answer delay
                </Label>
                <p className="text-xs text-muted-foreground">Delay before answering (milliseconds)</p>
              </div>
              <Input
                id="auto-answer-delay"
                type="number"
                min="0"
                value={autoAnswerDelayMs}
                onChange={(e) =>
                  updateSettings({ autoAnswerDelayMs: parseInt(e.target.value) || 0 })
                }
                className="w-[120px]"
              />
            </div>
          )}
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="ringtone" className="cursor-pointer">
                Ringtone
              </Label>
              <p className="text-xs text-muted-foreground">Incoming call sound</p>
            </div>
            <div className="flex items-center gap-2">
              <RingtonePreview preset={ringtonePreset} />
              <AppDropdown
                id="ringtone"
                value={ringtonePreset}
                onValueChange={(v) => updateSettings({ ringtonePreset: v })}
                className="w-[160px]"
                options={[
                  { value: "default", label: "Default" },
                  { value: "classic", label: "Classic" },
                  { value: "soft", label: "Soft" },
                  { value: "silent", label: "Silent" },
                ]}
              />
            </div>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label htmlFor="ringback" className="cursor-pointer">
                Ringback tone
              </Label>
              <p className="text-xs text-muted-foreground">Play tone while call is ringing</p>
            </div>
            <Checkbox
              id="ringback"
              checked={ringbackEnabled}
              onCheckedChange={(v) => updateSettings({ ringbackEnabled: v === true })}
            />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="moh" className="cursor-pointer">
                Music on hold
              </Label>
              <p className="text-xs text-muted-foreground">Hold music source</p>
            </div>
            <AppDropdown
              id="moh"
              value={mohPreset}
              onValueChange={(v) => updateSettings({ mohPreset: v })}
              className="w-[160px]"
              options={[
                { value: "system", label: "System" },
                { value: "silent", label: "Silent" },
              ]}
            />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label htmlFor="call-waiting" className="cursor-pointer">
                Call waiting
              </Label>
              <p className="text-xs text-muted-foreground">Allow multiple simultaneous calls</p>
            </div>
            <Checkbox
              id="call-waiting"
              checked={callWaitingEnabled}
              onCheckedChange={(v) => updateSettings({ callWaitingEnabled: v === true })}
            />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="max-calls" className="cursor-pointer">
                Max simultaneous calls
              </Label>
              <p className="text-xs text-muted-foreground">Maximum concurrent active calls</p>
            </div>
            <AppDropdown
              id="max-calls"
              value={String(maxSimultaneousCalls)}
              onValueChange={(v) => updateSettings({ maxSimultaneousCalls: parseInt(v, 10) })}
              className="w-[120px]"
              options={[
                { value: "1", label: "1" },
                { value: "2", label: "2" },
                { value: "3", label: "3" },
                { value: "4", label: "4" },
              ]}
            />
          </div>
        </div>
      </div>

      {/* Section 4: Network / RTP */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Network / RTP</h3>
        <div className="rounded-lg shadow-card divide-y divide-border/30">
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="rtp-range-low" className="cursor-pointer">
                Media port range
              </Label>
              <p className="text-xs text-muted-foreground">RTP/UDPTL allocation for Soft Phone and Fax (1024-65535)</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="rtp-range-low"
                type="number"
                min="1024"
                max="65535"
                value={mediaRangeLowDraft}
                onChange={(e) => setMediaRangeLowDraft(e.target.value)}
                onBlur={applyMediaRange}
                className="w-[110px] font-mono"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                id="rtp-range-high"
                type="number"
                min="1024"
                max="65535"
                value={mediaRangeHighDraft}
                onChange={(e) => setMediaRangeHighDraft(e.target.value)}
                onBlur={applyMediaRange}
                className="w-[110px] font-mono"
              />
            </div>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="jitter-min" className="cursor-pointer">
                Jitter buffer min
              </Label>
              <p className="text-xs text-muted-foreground">Minimum buffer size (milliseconds)</p>
            </div>
            <Input
              id="jitter-min"
              type="number"
              min="10"
              max="500"
              value={jitterBufferMinMs}
              onChange={(e) =>
                setJitterBuffer(parseInt(e.target.value) || 50, jitterBufferMaxMs)
              }
              className="w-[120px]"
            />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="jitter-max" className="cursor-pointer">
                Jitter buffer max
              </Label>
              <p className="text-xs text-muted-foreground">Maximum buffer size (milliseconds)</p>
            </div>
            <Input
              id="jitter-max"
              type="number"
              min="10"
              max="500"
              value={jitterBufferMaxMs}
              onChange={(e) =>
                setJitterBuffer(jitterBufferMinMs, parseInt(e.target.value) || 200)
              }
              className="w-[120px]"
            />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="dtmf-mode" className="cursor-pointer">
                DTMF mode
              </Label>
              <p className="text-xs text-muted-foreground">DTMF transmission method</p>
            </div>
            <AppDropdown
              id="dtmf-mode"
              value={dtmfMode}
              onValueChange={(v) => updateSettings({ dtmfMode: v as "rfc2833" | "sip-info" })}
              className="w-[160px]"
              options={[
                { value: "rfc2833", label: "RFC 2833" },
                { value: "sip-info", label: "SIP INFO" },
              ]}
            />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="dtmf-payload" className="cursor-pointer">
                DTMF payload type
              </Label>
              <p className="text-xs text-muted-foreground">RTP payload type for RFC 2833</p>
            </div>
            <Input
              id="dtmf-payload"
              type="number"
              min="96"
              max="127"
              value={dtmfPayloadType}
              onChange={(e) =>
                updateSettings({ dtmfPayloadType: parseInt(e.target.value) || 101 })
              }
              className="w-[120px]"
            />
          </div>
        </div>
      </div>

      {/* Section 5: Recording */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Recording</h3>
        <div className="rounded-lg shadow-card divide-y divide-border/30">
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label htmlFor="auto-record" className="cursor-pointer">
                Auto-record
              </Label>
              <p className="text-xs text-muted-foreground">Automatically record all calls</p>
            </div>
            <Checkbox
              id="auto-record"
              checked={autoRecordEnabled}
              onCheckedChange={(v) => updateSettings({ autoRecordEnabled: v === true })}
            />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="recording-format" className="cursor-pointer">
                Recording format
              </Label>
              <p className="text-xs text-muted-foreground">Audio file format</p>
            </div>
            <AppDropdown
              id="recording-format"
              value={recordingFormat}
              onValueChange={(v) => updateSettings({ recordingFormat: v as "wav" })}
              className="w-[120px]"
              options={[{ value: "wav", label: "WAV" }]}
            />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label htmlFor="recording-stereo" className="cursor-pointer">
                Stereo recording
              </Label>
              <p className="text-xs text-muted-foreground">Record in stereo (2 channels)</p>
            </div>
            <Checkbox
              id="recording-stereo"
              checked={recordingStereo}
              onCheckedChange={(v) => updateSettings({ recordingStereo: v === true })}
            />
          </div>
        </div>
      </div>

      {/* Section 6: Call Forwarding */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Call Forwarding</h3>
        <div className="rounded-lg shadow-card divide-y divide-border/30">
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="forward-all" className="cursor-pointer">
                Forward all calls
              </Label>
              <p className="text-xs text-muted-foreground">Forward all incoming calls</p>
            </div>
            <Checkbox
              id="forward-all"
              checked={forwardAllEnabled}
              onCheckedChange={(v) => updateSettings({ forwardAllEnabled: v === true })}
            />
          </div>
          {forwardAllEnabled && (
            <div className="flex items-center justify-between p-4">
              <div className="space-y-0.5 flex-1 min-w-0">
                <Label htmlFor="forward-all-target" className="cursor-pointer">
                  Forward all target
                </Label>
                <p className="text-xs text-muted-foreground">SIP URI or phone number</p>
              </div>
              <Input
                id="forward-all-target"
                type="text"
                value={forwardAllTarget}
                onChange={(e) => updateSettings({ forwardAllTarget: e.target.value })}
                className="w-[200px]"
                placeholder="sip:user@example.com"
              />
            </div>
          )}
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="forward-busy" className="cursor-pointer">
                Forward on busy
              </Label>
              <p className="text-xs text-muted-foreground">Forward when line is busy</p>
            </div>
            <Checkbox
              id="forward-busy"
              checked={forwardBusyEnabled}
              onCheckedChange={(v) => updateSettings({ forwardBusyEnabled: v === true })}
            />
          </div>
          {forwardBusyEnabled && (
            <div className="flex items-center justify-between p-4">
              <div className="space-y-0.5 flex-1 min-w-0">
                <Label htmlFor="forward-busy-target" className="cursor-pointer">
                  Forward busy target
                </Label>
                <p className="text-xs text-muted-foreground">SIP URI or phone number</p>
              </div>
              <Input
                id="forward-busy-target"
                type="text"
                value={forwardBusyTarget}
                onChange={(e) => updateSettings({ forwardBusyTarget: e.target.value })}
                className="w-[200px]"
                placeholder="sip:user@example.com"
              />
            </div>
          )}
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5 flex-1 min-w-0">
              <Label htmlFor="forward-no-answer" className="cursor-pointer">
                Forward on no answer
              </Label>
              <p className="text-xs text-muted-foreground">Forward when call is not answered</p>
            </div>
            <Checkbox
              id="forward-no-answer"
              checked={forwardNoAnswerEnabled}
              onCheckedChange={(v) => updateSettings({ forwardNoAnswerEnabled: v === true })}
            />
          </div>
          {forwardNoAnswerEnabled && (
            <>
              <div className="flex items-center justify-between p-4">
                <div className="space-y-0.5 flex-1 min-w-0">
                  <Label htmlFor="forward-no-answer-target" className="cursor-pointer">
                    Forward no answer target
                  </Label>
                  <p className="text-xs text-muted-foreground">SIP URI or phone number</p>
                </div>
                <Input
                  id="forward-no-answer-target"
                  type="text"
                  value={forwardNoAnswerTarget}
                  onChange={(e) => updateSettings({ forwardNoAnswerTarget: e.target.value })}
                  className="w-[200px]"
                  placeholder="sip:user@example.com"
                />
              </div>
              <div className="flex items-center justify-between p-4">
                <div className="space-y-0.5 flex-1 min-w-0">
                  <Label htmlFor="forward-no-answer-timeout" className="cursor-pointer">
                    No answer timeout
                  </Label>
                  <p className="text-xs text-muted-foreground">Seconds before forwarding</p>
                </div>
                <Input
                  id="forward-no-answer-timeout"
                  type="number"
                  min="5"
                  max="60"
                  value={forwardNoAnswerTimeout}
                  onChange={(e) =>
                    updateSettings({ forwardNoAnswerTimeout: parseInt(e.target.value) || 20 })
                  }
                  className="w-[120px]"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Section 7: Integration */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Integration</h3>
        <div className="rounded-lg shadow-card divide-y divide-border/30">
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label htmlFor="click-to-dial" className="cursor-pointer">
                Click-to-dial
              </Label>
              <p className="text-xs text-muted-foreground">Enable click-to-dial functionality</p>
            </div>
            <Checkbox
              id="click-to-dial"
              checked={clickToDialEnabled}
              onCheckedChange={(v) => updateSettings({ clickToDialEnabled: v === true })}
            />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label htmlFor="auto-open" className="cursor-pointer">
                Auto-open on incoming
              </Label>
              <p className="text-xs text-muted-foreground">Open softphone on incoming calls</p>
            </div>
            <Checkbox
              id="auto-open"
              checked={autoOpenOnIncoming}
              onCheckedChange={(v) => updateSettings({ autoOpenOnIncoming: v === true })}
            />
          </div>
        </div>
      </div>

      {/* Section 8: Audio Quality */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Audio Quality</h3>
        <div className="rounded-lg shadow-card divide-y divide-border/30">
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label htmlFor="vad" className="cursor-pointer">
                Voice activity detection (VAD)
              </Label>
              <p className="text-xs text-muted-foreground">Suppress silence packets to save bandwidth</p>
            </div>
            <Checkbox
              id="vad"
              checked={vadEnabled}
              onCheckedChange={(v) => updateSettings({ vadEnabled: v === true })}
            />
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label htmlFor="plc" className="cursor-pointer">
                Packet loss concealment (PLC)
              </Label>
              <p className="text-xs text-muted-foreground">Conceal missing audio packets by replaying the last frame</p>
            </div>
            <Checkbox
              id="plc"
              checked={plcEnabled}
              onCheckedChange={(v) => updateSettings({ plcEnabled: v === true })}
            />
          </div>
        </div>
      </div>

      {/* Section 9: Security */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Security</h3>
        <div className="rounded-lg shadow-card divide-y divide-border/30">
          <div className="flex items-center justify-between p-4">
            <div className="space-y-0.5">
              <Label htmlFor="srtp" className="cursor-pointer">
                SRTP encryption
              </Label>
              <p className="text-xs text-muted-foreground">Encrypt RTP media with SRTP</p>
            </div>
            <Checkbox
              id="srtp"
              checked={srtpEnabled}
              onCheckedChange={(v) => updateSettings({ srtpEnabled: v === true, srtpMode: v ? "optional" : "disabled" })}
            />
          </div>
          {srtpEnabled && (
            <div className="flex items-center justify-between p-4">
              <div className="space-y-0.5 flex-1 min-w-0">
                <Label htmlFor="srtp-mode" className="cursor-pointer">
                  SRTP mode
                </Label>
                <p className="text-xs text-muted-foreground">How SRTP is negotiated with the remote party</p>
              </div>
              <AppDropdown
                id="srtp-mode"
                value={srtpMode}
                onValueChange={(v) => updateSettings({ srtpMode: v as "disabled" | "optional" | "mandatory" })}
                className="w-[160px]"
                options={[
                  { value: "optional", label: "Optional" },
                  { value: "mandatory", label: "Mandatory" },
                ]}
              />
            </div>
          )}
        </div>
      </div>

      {/* Reset button */}
      <div className="flex justify-end">
        <Button variant="neutral" size="sm" onClick={handleReset}>
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Reset all to defaults
        </Button>
      </div>
    </div>
  );
}

/* ── Ringtone preview button ── */

function RingtonePreview({ preset }: { preset: string }) {
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const graphRef = useRef<ReturnType<typeof createRingtoneGraph> | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stop = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    graphRef.current?.destroy();
    graphRef.current = null;
    if (ctxRef.current && ctxRef.current.state !== "closed") {
      ctxRef.current.close().catch(() => {});
    }
    ctxRef.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    const config = RINGTONE_PRESETS[preset];
    if (!config) return;

    stop();

    const ctx = new AudioContext();
    ctxRef.current = ctx;
    setPlaying(true);

    const graph = createRingtoneGraph(ctx, config);
    graphRef.current = graph;

    // Play the burst pattern once for preview
    let offset = 0;
    for (const [onMs, offMs] of config.bursts) {
      const startAt = offset;
      const stopAt = offset + onMs;
      timersRef.current.push(setTimeout(() => graph.startTone(), startAt));
      timersRef.current.push(setTimeout(() => graph.stopTone(), stopAt));
      offset = stopAt + offMs;
    }

    // Auto-stop after the full burst sequence finishes
    timersRef.current.push(setTimeout(() => stop(), offset + 150));
  }, [preset, stop]);

  useEffect(() => () => stop(), [stop]);

  const isSilent = preset === "silent";

  return (
    <Button
      variant="neutral"
      size="icon-sm"
      onClick={playing ? stop : play}
      disabled={isSilent}
      aria-label={playing ? "Stop preview" : "Preview ringtone"}
    >
      {playing ? <StopIcon className="h-3 w-3" /> : <Play className="h-3 w-3" />}
    </Button>
  );
}

/* ── Visualizer preview with simulated waveform ── */

/**
 * Generates a dynamic synthetic waveform that simulates a real conversation:
 * speech bursts, quiet gaps, alternating speakers, and varying intensity.
 */
function useDemoWaveform() {
  const ref = useRef<{ send: number[]; recv: number[] }>({ send: [], recv: [] });

  const tick = useCallback(() => {
    const now = performance.now() / 1000;
    const SAMPLES = 320;
    const send: number[] = [];
    const recv: number[] = [];

    // Conversation-like envelopes: sharp attack, hold, decay with quiet gaps.
    // The two speakers alternate with some overlap, like a real call.
    const cycle = 6.0; // full conversation cycle in seconds
    const phase = (now % cycle) / cycle; // 0..1

    // Speaker A (you): talks ~0.0–0.35, quiet ~0.35–0.55, talks ~0.55–0.7, quiet rest
    // Speaker B (them): quiet ~0.0–0.2, talks ~0.2–0.6, quiet ~0.6–0.8, talks ~0.8–1.0
    const speakA = (p: number) => {
      if (p < 0.03) return p / 0.03; // attack
      if (p < 0.30) return 0.7 + 0.3 * Math.sin(p * 40); // sustain with breath variation
      if (p < 0.38) return Math.max(0, (0.38 - p) / 0.08); // decay
      if (p < 0.55) return 0; // gap
      if (p < 0.58) return (p - 0.55) / 0.03; // attack
      if (p < 0.68) return 0.5 + 0.3 * Math.sin(p * 55); // shorter burst
      if (p < 0.73) return Math.max(0, (0.73 - p) / 0.05); // decay
      return 0;
    };

    const speakB = (p: number) => {
      if (p < 0.18) return 0;
      if (p < 0.22) return (p - 0.18) / 0.04; // attack
      if (p < 0.52) return 0.6 + 0.4 * Math.sin(p * 35 + 1); // long sustain
      if (p < 0.60) return Math.max(0, (0.60 - p) / 0.08); // decay
      if (p < 0.78) return 0;
      if (p < 0.82) return (p - 0.78) / 0.04; // attack
      if (p < 0.95) return 0.8 + 0.2 * Math.sin(p * 45 + 2); // energetic burst
      return Math.max(0, (1.0 - p) / 0.05); // decay
    };

    const sendEnv = speakA(phase);
    const recvEnv = speakB(phase);

    for (let i = 0; i < SAMPLES; i++) {
      const t = i / SAMPLES;

      // Rich harmonic content: multiple formant-like frequencies + noise
      const sBase =
        Math.sin(t * Math.PI * 14 + now * 9) * 0.35 +
        Math.sin(t * Math.PI * 33 + now * 16) * 0.25 +
        Math.sin(t * Math.PI * 58 + now * 25) * 0.18 +
        Math.sin(t * Math.PI * 90 + now * 38) * 0.08 +
        (Math.random() - 0.5) * 0.14;

      const rBase =
        Math.sin(t * Math.PI * 11 + now * 7 + 2) * 0.30 +
        Math.sin(t * Math.PI * 28 + now * 13 + 1) * 0.30 +
        Math.sin(t * Math.PI * 52 + now * 21 + 3) * 0.20 +
        Math.sin(t * Math.PI * 82 + now * 33 + 1) * 0.10 +
        (Math.random() - 0.5) * 0.10;

      send.push(sBase * sendEnv);
      recv.push(rBase * recvEnv);
    }

    ref.current = { send, recv };
  }, []);

  useEffect(() => {
    let raf: number;
    const loop = () => { tick(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tick]);

  return ref;
}

function VisualizerPreviewSection({
  value,
  showVisualizer,
  onChange,
  onToggleShow,
}: {
  value: VisualizerId;
  showVisualizer: boolean;
  onChange: (v: VisualizerId) => void;
  onToggleShow: (v: boolean) => void;
}) {
  const waveformRef = useDemoWaveform();

  const sharedProps = {
    waveformRef,
    className: "w-full rounded-lg overflow-hidden bg-card/95 border border-border/40 shadow-card",
    style: { height: 240, minHeight: 240 },
  };

  const renderVisualizer = () => {
    switch (value) {
      case "ribbon": return <WaveformRibbon {...sharedProps} />;
      case "aurora": return <FrequencyAurora {...sharedProps} />;
      case "ekg": return <HeartbeatEKG {...sharedProps} />;
      case "terrain": return <TerrainRange {...sharedProps} />;
      case "bars": return <BarSpectrum {...sharedProps} />;
      case "rain": return <DigitalRain {...sharedProps} />;
      case "nebula":
      default: return <ParticleNebula {...sharedProps} />;
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Radio className="h-4 w-4 text-muted-foreground" />
        Audio Visualization
      </h3>
      <div className="rounded-lg shadow-card overflow-hidden">
        {/* Selector bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="space-y-0.5">
            <Label htmlFor="viz-select" className="cursor-pointer text-sm">
              Visualizer style
            </Label>
            <p className="text-xs text-muted-foreground">
              Live preview with simulated audio
            </p>
          </div>
          <AppDropdown
            id="viz-select"
            value={value}
            onValueChange={(v) => onChange(v as VisualizerId)}
            className="w-[180px]"
            options={VISUALIZER_OPTIONS.map((opt) => ({
              value: opt.id,
              label: opt.label,
            }))}
          />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="space-y-0.5">
            <Label htmlFor="show-visualizer" className="cursor-pointer text-sm">
              Show visualizer during calls
            </Label>
            <p className="text-xs text-muted-foreground">
              Hide the in-call animation panel for a cleaner view
            </p>
          </div>
          <Checkbox
            id="show-visualizer"
            checked={showVisualizer}
            onCheckedChange={(v) => onToggleShow(v === true)}
          />
        </div>

        {/* Preview canvas */}
        <div className="relative">
          {renderVisualizer()}
          {/* Legend overlay */}
          <div className="absolute bottom-2 left-3 flex items-center gap-3 text-2xs font-medium text-foreground/60">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
              You
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
              Them
            </span>
          </div>
          {/* "Preview" badge */}
          <div className="absolute top-2 right-3 text-3xs uppercase tracking-wider font-semibold text-foreground/20">
            Preview
          </div>
        </div>
      </div>
    </div>
  );
}
