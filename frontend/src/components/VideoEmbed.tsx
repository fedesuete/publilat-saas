// Muestra un video a partir de una URL. Soporta YouTube, Vimeo y archivos directos (.mp4/.webm).
// No aloja nada: arma el <iframe>/<video> según el link. Responsivo 16:9.

function youtubeId(url: string): string | null {
  // youtu.be/ID · youtube.com/watch?v=ID · /embed/ID · /shorts/ID
  const m =
    url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function vimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : null;
}

function isDirectVideo(url: string): boolean {
  return /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url);
}

export function videoThumb(url: string): string | null {
  const yt = youtubeId(url);
  return yt ? `https://img.youtube.com/vi/${yt}/hqdefault.jpg` : null;
}

export default function VideoEmbed({ url, className = "" }: { url: string; className?: string }) {
  const yt = youtubeId(url);
  const vm = yt ? null : vimeoId(url);

  const frame = "absolute inset-0 h-full w-full";
  let inner: React.ReactNode;

  if (yt) {
    inner = (
      <iframe
        className={frame}
        src={`https://www.youtube.com/embed/${yt}`}
        title="Tutorial"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  } else if (vm) {
    inner = (
      <iframe
        className={frame}
        src={`https://player.vimeo.com/video/${vm}`}
        title="Tutorial"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
      />
    );
  } else if (isDirectVideo(url)) {
    inner = <video className={frame} src={url} controls playsInline preload="metadata" />;
  } else {
    // Link desconocido: no lo embebemos, ofrecemos abrirlo.
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800/60 p-6 text-sm text-wa-green hover:bg-slate-800 ${className}`}
      >
        ▶ Ver video
      </a>
    );
  }

  return (
    <div className={`relative w-full overflow-hidden rounded-lg bg-black ${className}`} style={{ aspectRatio: "16 / 9" }}>
      {inner}
    </div>
  );
}
