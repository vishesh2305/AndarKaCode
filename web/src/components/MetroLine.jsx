// The pipeline as a cartoon metro line. At Build it splits into two tracks (Pages on the Windows GPU,
// Backend on the Mac) that meet again at the Sync gate. The mascot rides to the current station.
import { STATIONS, STATUS_WORDS } from "../stations.js";

// Room above the top branch and below the bottom branch for two lines of labels each.
const MAIN_Y = 145;
const TOP_Y = 80;
const BOTTOM_Y = 210;
const VIEW_HEIGHT = 300;
const POS = {
  upload: [70, MAIN_Y],
  read: [190, MAIN_Y],
  plan: [310, MAIN_Y],
  pages: [470, TOP_Y],
  backend: [470, BOTTOM_Y],
  sync: [630, MAIN_Y],
  wire: [750, MAIN_Y],
  verify: [855, MAIN_Y],
  ready: [955, MAIN_Y],
};

const straight = (a, b) => `M${POS[a][0]} ${POS[a][1]} L${POS[b][0]} ${POS[b][1]}`;
// Split from the main line to a branch, and join from a branch back to the main line.
const split = (y) => `M310 ${MAIN_Y} L350 ${MAIN_Y} C385 ${MAIN_Y} 385 ${y} 420 ${y} L470 ${y}`;
const join = (y) => `M470 ${y} L520 ${y} C555 ${y} 555 ${MAIN_Y} 590 ${MAIN_Y} L630 ${MAIN_Y}`;

// Each track leads INTO a station and takes that station's look.
const TRACKS = [
  { to: "read", d: straight("upload", "read") },
  { to: "plan", d: straight("read", "plan") },
  { to: "pages", d: split(TOP_Y) },
  { to: "backend", d: split(BOTTOM_Y) },
  { to: "sync", from: "pages", d: join(TOP_Y) },
  { to: "sync", from: "backend", d: join(BOTTOM_Y) },
  { to: "wire", d: straight("sync", "wire") },
  { to: "verify", d: straight("wire", "verify") },
  { to: "ready", d: straight("verify", "ready") },
];

const ICONS = {
  upload: <path d="M0 7 V-6 M-6 0 L0 -7 L6 0" />,
  read: (
    <>
      <path d="M-9 0 Q0 -9 9 0 Q0 9 -9 0 Z" />
      <circle r="2.6" className="metro-icon-fill" />
    </>
  ),
  plan: <path d="M-7 -6 H7 M-7 0 H7 M-7 6 H3" />,
  pages: <path d="M-6 -8 H3 L7 -4 V8 H-6 Z M3 -8 V-4 H7" />,
  backend: (
    <>
      <ellipse cx="0" cy="-5" rx="7" ry="3" />
      <path d="M-7 -5 V5 Q0 10 7 5 V-5 M-7 0 Q0 5 7 0" />
    </>
  ),
  sync: <path d="M-8 -3 H8 M-8 3 H8" />,
  wire: <path d="M-3 -9 V-4 M3 -9 V-4 M-6 -4 H6 V1 Q0 7 -6 1 Z M0 4 V9" />,
  verify: <path d="M-7 0 L-2 5 L7 -5" />,
  ready: <path d="M0 -8 L2.4 -2.5 L8 -2 L3.5 1.8 L5 8 L0 4.6 L-5 8 L-3.5 1.8 L-8 -2 L-2.4 -2.5 Z" />,
};

// A track looks like the station it leads into; the two tracks into Sync stay grey until their branch is done.
function trackLook(track, stations) {
  if (track.from && stations[track.from].status !== "done") return "waiting";
  return stations[track.to].status;
}

function Mascot({ station, mood }) {
  // During Build the mascot rides between the two tracks; elsewhere it sits just above its station.
  const [x, y] = station === "pages" || station === "backend" ? [470, MAIN_Y] : [POS[station][0], POS[station][1] - 58];
  return (
    <g className="mascot-travel" style={{ transform: `translate(${x}px, ${y}px)` }} aria-hidden="true">
      <g className={`mascot mascot-${mood}`}>
        <rect x="-17" y="-15" width="34" height="30" rx="12" className="mascot-body" />
        <g className="mascot-eyes">
          {mood === "worried" ? (
            <path d="M-9 -4 L-4 -1 L-9 2 M9 -4 L4 -1 L9 2" className="mascot-line" />
          ) : (
            <>
              <circle cx="-6" cy="-2" r="2.6" className="mascot-eye" />
              <circle cx="6" cy="-2" r="2.6" className="mascot-eye" />
            </>
          )}
        </g>
        {mood === "happy" && <path d="M-6 5 Q0 10 6 5" className="mascot-line" />}
        {mood === "busy" && <path d="M-4 6 H4" className="mascot-line" />}
        {mood === "worried" && <path d="M-5 8 Q0 4 5 8" className="mascot-line" />}
      </g>
    </g>
  );
}

export function MetroLine({ status, selected, onSelect }) {
  const { stations, current } = status;
  const mood = stations[current]?.status === "failed" ? "worried" : current === "ready" && stations.ready.status === "done" ? "happy" : "busy";

  return (
    <svg className="metro" viewBox={`0 0 1020 ${VIEW_HEIGHT}`} role="group" aria-label="Pipeline: where your project is now">
      {TRACKS.map((t, i) => (
        <path key={i} d={t.d} className={`metro-track metro-track-${trackLook(t, stations)}`} />
      ))}

      {Object.entries(POS).map(([id, [x, y]]) => {
        const s = stations[id];
        const info = STATIONS[id];
        const below = id !== "pages";
        return (
          <g
            key={id}
            className={`metro-station metro-${s.status}${selected === id ? " metro-selected" : ""}`}
            transform={`translate(${x} ${y})`}
            role="button"
            tabIndex={0}
            aria-pressed={selected === id}
            aria-label={`${info.title}: ${STATUS_WORDS[s.status]}${s.remembered ? ", reused from memory" : ""}`}
            onClick={() => onSelect(id)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(id))}
          >
            <circle r="30" className="metro-hit" />
            <circle r="23" className="metro-dot" />
            <g className="metro-icon">{ICONS[id]}</g>
            {s.status === "done" && (
              <g transform="translate(17 -17)" className="metro-badge metro-badge-done">
                <circle r="8" />
                <path d="M-3.5 0 L-1 2.8 L3.8 -2.6" />
              </g>
            )}
            {s.remembered && (
              <g transform="translate(-17 -17)" className="metro-badge metro-badge-memory">
                <title>Reused earlier work from memory</title>
                <circle r="8" />
                <path d="M3.4 -1.6 A3.8 3.8 0 1 0 3.6 1.6 M3.6 -4.4 V-1.4 H0.6" />
              </g>
            )}
            {s.status === "failed" && (
              <g transform="translate(17 -17)" className="metro-badge metro-badge-failed">
                <circle r="8" />
                <path d="M0 -4 V1 M0 4 V4.2" />
              </g>
            )}
            {/* Name first, then place, whether the labels sit below or above the station. */}
            <text y={below ? 48 : -54} className="metro-title">
              {info.title}
            </text>
            <text y={below ? 66 : -36} className="metro-where">
              {info.where}
            </text>
          </g>
        );
      })}

      <Mascot station={current} mood={mood} />
    </svg>
  );
}
