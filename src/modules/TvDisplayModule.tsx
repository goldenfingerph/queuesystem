import { useEffect, useState, useRef, useCallback } from 'react';
import { Bell, VolumeX, Tv, Speaker, Megaphone, ChevronLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useWebSocket } from '@/lib/useWebSocket';

interface CalledTicket {
  id: number; number: string; counter_id: number | null; counter_number: number | null;
  service_name: string; category_label: string;
}

interface WaitingTicket {
  id: number; number: string; service_name: string; service_name_ar: string; category_label: string; queue_position: number;
}

interface Ad { id: number; filename: string; is_active: number; sort_order: number }

export function TvDisplayModule() {
  const [latestTicket, setLatestTicket] = useState<CalledTicket | null>(null);
  const [currentlyServing, setCurrentlyServing] = useState<CalledTicket[]>([]);
  const [waitingTickets, setWaitingTickets] = useState<WaitingTicket[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [adsEnabled, setAdsEnabled] = useState(true);
  const [adsIntervalSec, setAdsIntervalSec] = useState(15);
  // Advertisements are intentionally always muted so queue announcements remain audible.
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const voiceEnabledRef = useRef(voiceEnabled);
  voiceEnabledRef.current = voiceEnabled;
  const [bellEnabled, setBellEnabled] = useState(true);
  const [currentAd, setCurrentAd] = useState(0);
  const [adPlaybackError, setAdPlaybackError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const { lastMessage } = useWebSocket();
  const lastSpokenRef = useRef<Set<number>>(new Set());

  // Load initial state
  useEffect(() => {
    api.get<{ logoUrl: string | null }>('/logo').then((r) => setLogoUrl(r.logoUrl ? `${r.logoUrl}?v=${Date.now()}` : null)).catch(() => {});
    api.get<{ settings: Record<string, string> }>('/settings').then((r) => {
      setAdsEnabled(r.settings.ads_enabled === '1');
      const configuredInterval = Number(r.settings.ads_interval_sec);
      if (Number.isFinite(configuredInterval)) setAdsIntervalSec(Math.min(360, Math.max(5, configuredInterval)));
      setVoiceEnabled(r.settings.voice_enabled === '1');
      setBellEnabled(r.settings.bell_enabled === '1');
    });
    api.get<{ ads: Ad[] }>('/ads').then((r) => setAds(r.ads.filter((a) => a.is_active)));
    loadTvQueue();
  }, []);

  const loadTvQueue = () => {
    api.get<{ currentTickets: CalledTicket[]; latestTicket: CalledTicket | null; currentlyServing: CalledTicket[]; waitingTickets: WaitingTicket[] }>('/tv/queue')
      .then((r) => {
        setLatestTicket(r.latestTicket ?? null);
        setCurrentlyServing(r.currentlyServing ?? []);
        setWaitingTickets(r.waitingTickets ?? []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (lastMessage && (lastMessage.type === 'ticket-called' || lastMessage.type === 'ticket-recalled' || lastMessage.type === 'ticket-completed' || lastMessage.type === 'ticket-created' || lastMessage.type === 'ticket-transferred' || lastMessage.type === 'queue-updated')) {
      loadTvQueue();
    }
  }, [lastMessage]);

  useEffect(() => () => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') void audioContextRef.current.close();
  }, []);

  const handleVoiceButton = async () => {
    // Once browser audio has been unlocked, the same control toggles announcements.
    if (audioUnlocked && voiceEnabled) {
      voiceEnabledRef.current = false;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      setVoiceEnabled(false);
      return;
    }

    // This must run directly from the user's click so browsers can unlock audio.
    try {
      let context = audioContextRef.current;
      if (!context && typeof AudioContext !== 'undefined') {
        context = new AudioContext();
        audioContextRef.current = context;
      }
      if (context && context.state !== 'running') await context.resume();

      if (context?.state === 'running') {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.18, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.25);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.25);
      }

      setAudioUnlocked(true);
      voiceEnabledRef.current = true;
      setVoiceEnabled(true);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const ready = new SpeechSynthesisUtterance('Voice announcements enabled. Audio test successful.');
        ready.lang = 'en-US';
        ready.rate = 0.9;
        window.speechSynthesis.speak(ready);
      }
    } catch (error) {
      console.error('Unable to unlock TV display audio:', error);
      setAudioUnlocked(false);
    }
  };

  // Voice announcement (English only)
  const announce = useCallback((ticket: CalledTicket) => {
    if (!voiceEnabled || !('speechSynthesis' in window)) return;
    if (lastSpokenRef.current.has(ticket.id)) return;
    try {
      // Optional bell sound
      const ctx = audioContextRef.current;
      if (bellEnabled && ctx?.state === 'running') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      }

      // Speak ticket digits individually (e.g. 4501 -> "four five zero one").
      const digitWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
      const spokenTicketNumber = String(ticket.number)
        .split('')
        .map((character) => /[0-9]/.test(character) ? digitWords[Number(character)] : character)
        .join(', ');

      // Spoken announcement
      const utter = new SpeechSynthesisUtterance(
        `Ticket number, ${spokenTicketNumber}. Please proceed to counter ${ticket.counter_number}.`
      );
      utter.lang = 'en-US';
      utter.rate = 0.88;
      utter.pitch = 0.96;
      utter.onstart = () => console.info('[TV] Voice announcement started:', ticket.number);
      // Add a soft, delayed PA-style echo tail after the main announcement.
      // Browser speechSynthesis cannot be routed through Web Audio for true reverb,
      // so this quietly repeats the destination phrase once to create a subtle hall-like tail.
      utter.onend = () => {
        if (!voiceEnabledRef.current) return;
        window.setTimeout(() => {
          if (!voiceEnabledRef.current || !('speechSynthesis' in window)) return;
          const echo = new SpeechSynthesisUtterance(
            `Please proceed to counter ${ticket.counter_number}.`
          );
          echo.lang = 'en-US';
          echo.rate = 0.96;
          echo.pitch = 0.92;
          echo.volume = 0.18;
          window.speechSynthesis.speak(echo);
        }, 260);
      };
      utter.onerror = (event) => {
        console.error('[TV] Voice announcement failed:', event.error);
        lastSpokenRef.current.delete(ticket.id);
      };
      // Resume Chrome's speech engine and enqueue only after the browser is ready.
      window.speechSynthesis.resume();
      window.setTimeout(() => {
        window.speechSynthesis.resume();
        window.speechSynthesis.speak(utter);
        lastSpokenRef.current.add(ticket.id);
      }, 250);
    } catch { /* speech not available */ }
  }, [voiceEnabled, bellEnabled]);

  useEffect(() => {
    if (!lastMessage || (lastMessage.type !== 'ticket-called' && lastMessage.type !== 'ticket-recalled')) return;
    const messageType = lastMessage.type;
    const payload = lastMessage.payload as { ticketId?: number | string } | undefined;
    const ticketId = Number(payload?.ticketId);
    if (!Number.isFinite(ticketId) || ticketId <= 0) return;

    // Do not cancel this lookup when a follow-up queue-updated WebSocket
    // message arrives. That message can otherwise clean up this effect
    // before the ticket fetch completes.
    const loadAndAnnounce = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const result = await api.get<{ currentTickets: CalledTicket[]; latestTicket: CalledTicket | null; currentlyServing: CalledTicket[]; waitingTickets: WaitingTicket[] }>('/tv/queue');
          setLatestTicket(result.latestTicket ?? null);
          setCurrentlyServing(result.currentlyServing ?? []);
          setWaitingTickets(result.waitingTickets ?? []);
          const ticket = (result.currentTickets ?? []).find((item) => Number(item.id) === ticketId);
          if (ticket) {
            if (messageType === 'ticket-recalled') lastSpokenRef.current.delete(ticketId);
            announce(ticket);
            return;
          }
        } catch (error) {
          console.error('[TV] Unable to load ticket for voice announcement:', error);
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      console.warn('[TV] Called ticket was not present in the TV queue after retries:', ticketId);
    };

    void loadAndAnnounce();
  }, [lastMessage, announce]);

  // Clear playback errors whenever the selected advertisement changes.
  useEffect(() => {
    setAdPlaybackError(null);
  }, [currentAd, ads]);


  const activeAds = adsEnabled ? ads.filter((a) => a.is_active) : [];

  // Rotate ads at the configured interval even when a video is longer than
  // the selected display interval. Shorter videos still advance on onEnded.
  useEffect(() => {
    if (activeAds.length < 2) return;
    const timer = window.setTimeout(() => {
      setCurrentAd((previous) => (previous + 1) % activeAds.length);
    }, adsIntervalSec * 1000);
    return () => window.clearTimeout(timer);
  }, [activeAds.length, adsIntervalSec, currentAd]);

  return (
    <div className="flex h-screen flex-col bg-navy-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-navy-800 px-8 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-500">
            {logoUrl ? <img src={logoUrl} alt="Organization logo" className="h-full w-full rounded-lg object-contain p-0.5" /> : <Tv className="h-6 w-6" strokeWidth={2.2} />}
          </div>
          <div>
            <p className="text-xl font-bold">INFINITY SERVICES</p>
            <p className="text-base font-semibold text-brand-200">Now Serving <span className="ml-2" dir="rtl" lang="ar">الرقم الحالي</span></p>
          </div>
        </div>
        <div className="group fixed right-4 top-4 z-50 flex items-center gap-2 rounded-xl border border-white/15 bg-navy-950/90 p-2 shadow-2xl backdrop-blur-md">
          <button type="button" className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400" title="Hover to show display controls" aria-label="Show display controls">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="pointer-events-none flex max-w-0 items-center gap-2 overflow-hidden opacity-0 transition-all duration-200 group-hover:pointer-events-auto group-hover:max-w-[240px] group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:max-w-[240px] group-focus-within:opacity-100">
            <button onClick={() => setBellEnabled((enabled) => !enabled)} className="shrink-0 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20" title={bellEnabled ? "Turn speaker chime off" : "Turn speaker chime on"} aria-label="Toggle speaker chime">
              {bellEnabled ? <Speaker className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </button>
            <button onClick={handleVoiceButton} className="shrink-0 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20" title={voiceEnabled ? "Disable voice announcements" : "Enable voice announcements"} aria-label="Toggle voice announcements">
              {voiceEnabled ? <Megaphone className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </button>
            <a href="#/" className="shrink-0 whitespace-nowrap rounded-lg bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/20">Back to App</a>
          </div>
        </div>
      </div>

      {/* TV layout: waiting queue left; now serving, recent calls, and ad stacked on the right */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-2 lg:grid-cols-[minmax(230px,1fr)_minmax(0,3fr)] lg:grid-rows-1">
        {/* Waiting Queue */}
        <div className="flex min-h-0 flex-col rounded-2xl bg-navy-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-lg font-bold uppercase tracking-wide text-navy-200">Waiting Queue <span className="ml-2 text-brand-200" dir="rtl" lang="ar">قائمة الانتظار</span></p>
            <span className="text-base font-semibold text-navy-300">{waitingTickets.length} waiting · انتظار</span>
          </div>
          <div className="min-h-0 space-y-2 overflow-y-auto">
            {waitingTickets.slice(0, 12).map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-10 shrink-0 text-base font-bold text-brand-300">#{t.queue_position}</span>
                  <span className="font-mono text-2xl font-bold text-brand-300">{t.number}</span>
                  <span className="min-w-0 truncate text-base text-navy-200"><span className="block truncate">{t.service_name}</span>{t.service_name_ar && <span className="block truncate text-sm text-brand-200" dir="rtl" lang="ar">{t.service_name_ar}</span>}</span>
                </div>
                {t.queue_position === 1 && <span className="shrink-0 rounded-lg bg-brand-500/20 px-3 py-1 text-sm font-bold text-brand-200">NEXT · التالي</span>}
              </div>
            ))}
            {waitingTickets.length === 0 && <p className="py-3 text-center text-base text-navy-300">No waiting tickets <span className="block" dir="rtl" lang="ar">لا توجد أرقام في الانتظار</span></p>}
            {waitingTickets.length > 12 && <p className="pt-2 text-center text-sm text-navy-300">Showing next 12 of {waitingTickets.length} waiting tickets <span className="block" dir="rtl" lang="ar">عرض الأرقام الاثني عشر التالية من قائمة الانتظار</span></p>}
          </div>
        </div>

        {/* Right side: latest call, currently serving tickets, and advertisement */}
        <div className="flex min-h-0 min-w-0 flex-col gap-2">
          {/* Latest call: one large ticket in the center */}
          <div className="flex min-h-[220px] flex-[1.15] items-stretch justify-center overflow-hidden rounded-2xl p-1">
            {latestTicket ? (
              <div key={latestTicket.id} className="flex min-h-48 w-full max-w-5xl flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-center">
                <p className="text-lg font-bold uppercase tracking-widest text-brand-100">Now Serving <span className="ml-2" dir="rtl" lang="ar">الرقم الحالي</span></p>
                <p className="my-3 text-7xl font-extrabold tracking-wider text-white sm:text-8xl">{latestTicket.number}</p>
                <div className="flex items-center gap-4 rounded-xl bg-white/10 px-6 py-3">
                  <span className="text-lg font-semibold text-brand-100">Counter <span className="ml-1" dir="rtl" lang="ar">النافذة</span></span>
                  <span className="text-5xl font-extrabold text-white">{latestTicket.counter_number}</span>
                </div>
                <p className="mt-3 text-xl font-semibold text-brand-100">{latestTicket.service_name}</p>
                {latestTicket.category_label && <p className="text-base text-brand-100">{latestTicket.category_label}</p>}
              </div>
            ) : (
              <div className="flex min-h-48 w-full flex-col items-center justify-center rounded-2xl bg-navy-900 p-8 text-navy-300">
                <Bell className="mb-4 h-16 w-16" />
                <p className="text-2xl font-semibold text-center">Waiting for first call... <span className="mt-2 block text-xl" dir="rtl" lang="ar">بانتظار أول نداء</span></p>
              </div>
            )}
          </div>

          {/* Older active tickets stay visible here until Counter Desk completes them. */}
          <div className="shrink-0 rounded-2xl bg-navy-900 px-4 py-3">
            <p className="mb-3 text-center text-base font-bold uppercase tracking-wide text-navy-300">Currently Serving <span className="ml-2 text-brand-200" dir="rtl" lang="ar">قيد الخدمة</span></p>
            {currentlyServing.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                {currentlyServing.map((ticket) => (
                  <div key={ticket.id} className="min-w-0 rounded-xl bg-white/5 px-3 py-2 text-center">
                    <p className="truncate font-mono text-3xl font-extrabold text-brand-300">{ticket.number}</p>
                    <p className="text-sm font-semibold text-brand-100">Counter {ticket.counter_number} <span dir="rtl" lang="ar">النافذة</span></p>
                    <p className="truncate text-xs text-navy-200">{ticket.service_name}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-2 text-center text-sm text-navy-300">No other tickets currently serving <span className="block" dir="rtl" lang="ar">لا توجد أرقام أخرى قيد الخدمة</span></p>
            )}
          </div>

          {/* Advertisement */}
          <div className="min-h-[150px] flex-1">
            {activeAds.length > 0 ? (
              <div className="relative flex h-full min-h-[150px] items-center justify-center overflow-hidden rounded-2xl bg-black">
                <video
                  key={activeAds[currentAd % activeAds.length].id}
                  ref={videoRef}
                  src={`/api/media/ads/${activeAds[currentAd % activeAds.length].filename}`}
                  className="h-full w-full object-contain"
                  autoPlay
                  playsInline
                  preload="auto"
                  loop={activeAds.length === 1}
                  muted={true}
                  onLoadedData={() => setAdPlaybackError(null)}
                  onCanPlay={(event) => {
                    const video = event.currentTarget;
                    video.muted = true;
                    void video.play().catch((error) => {
                      setAdPlaybackError('The browser blocked video playback. Reload the TV display and check that the video file is accessible.');
                      console.error('[TV] Advertisement autoplay was blocked:', error);
                    });
                  }}
                  onPlaying={() => setAdPlaybackError(null)}
                  onError={(event) => {
                    const mediaError = event.currentTarget.error;
                    const reason = mediaError?.code === 4
                      ? 'This browser cannot play this video format or codec. Convert it to H.264 MP4.'
                      : mediaError?.code === 3
                        ? 'The browser received the video but could not decode it. Convert it to H.264 MP4.'
                        : mediaError?.code === 2
                          ? 'A network or server error interrupted the video. Check the PC 1 server and advertisement file.'
                          : 'The video could not be loaded. Check that the uploaded file exists on the PC 1 server.';
                    setAdPlaybackError(reason);
                    console.error('[TV] Advertisement playback error:', mediaError?.code, mediaError?.message);
                  }}
                  onEnded={() => setCurrentAd((prev) => (prev + 1) % activeAds.length)}
                />
                {adPlaybackError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-navy-950/95 p-4 text-center">
                    <Tv className="mb-3 h-10 w-10 text-amber-300" />
                    <p className="mb-2 text-lg font-bold text-white">Advertisement cannot play <span className="block" dir="rtl" lang="ar">تعذر تشغيل الإعلان</span></p>
                    <p className="text-xs leading-relaxed text-navy-200">{adPlaybackError}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full min-h-[150px] flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-navy-800 to-navy-900">
                <Tv className="mb-4 h-20 w-20 text-navy-400" />
                <p className="text-xl font-semibold text-navy-200">INFINITY SERVICES</p>
                <p className="mt-2 text-base text-navy-300">No advertisements configured <span className="block" dir="rtl" lang="ar">لا توجد إعلانات</span></p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
