import React, { useState, useEffect } from 'react';

const BOARD = 8;
const DESIGN = 5;
const SEQ_CAP = 500;      
const FUTURE_ROUNDS = 2;   
const ROLLOUTS = 25;       
const ANIMATION_DELAY = 800; 

const rot = m => m[0].map((_, c) => m.map(r => r[c]).reverse());
const reflectH = m => m.map(row => [...row].reverse());
const reflectV = m => [...m].reverse();
const uniq = a => a.filter((p, i) => a.findIndex(q => JSON.stringify(q) === JSON.stringify(p)) === i);
const base = [
  [[1, 1, 1, 1, 1]],
  [[1, 1, 1, 1]],
  [[1, 1, 1]],
  [[1, 1], [1, 1]],
  [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
  [[1, 1, 1], [1, 1, 1]],
  [[0, 1, 0], [1, 1, 1]],
  [[1, 0], [1, 0], [1, 1]],
  [[1, 1], [0, 1]],
  [[1, 0, 0], [1, 0, 0], [1, 1, 1]],
  [[1, 1, 0], [0, 1, 1]],
];
let PIECES = uniq(base.flatMap(b => [
  b,
  rot(b),
  rot(rot(b)),
  rot(rot(rot(b))),
  reflectH(b),
  reflectH(rot(b)),
  reflectH(rot(rot(b))),
  reflectH(rot(rot(rot(b)))),
  reflectV(b),
  reflectV(rot(b)),
  reflectV(rot(rot(b))),
  reflectV(rot(rot(rot(b))))
]));

const grid = (r, c, f = false) => Array.from({ length: r }, () => Array(c).fill(f));
const clone = g => g.map(r => [...r]);
const samplePiece = () => PIECES[Math.random() * PIECES.length | 0];

const clearLines = b => {
  const linesToClear = [];

  for (let r = 0; r < BOARD; r++) {
    if (b[r].every(Boolean)) {
      linesToClear.push({ type: 'row', index: r });
    }
  }

  for (let c = 0; c < BOARD; c++) {
    if (b.every(r => r[c])) {
      linesToClear.push({ type: 'col', index: c });
    }
  }

  linesToClear.forEach(line => {
    if (line.type === 'row') {
      b[line.index].fill(false);
    } else {
      for (let r = 0; r < BOARD; r++) {
        b[r][line.index] = false;
      }
    }
  });

  return linesToClear.length;
};

const holes = b => {
  let h = 0;
  for (let c = 0; c < BOARD; c++) {
    let seen = false;
    for (let r = 0; r < BOARD; r++) {
      if (b[r][c]) seen = true; else if (seen) h++;
    }
  }
  return h;
};

const centrePenalty = b => {
  let p = 0;
  for (let r = 0; r < BOARD; r++)
    for (let c = 0; c < BOARD; c++) if (b[r][c]) p += 1 + Math.abs(r - 3.5) + Math.abs(c - 3.5);
  return p;
};

const adjacencyScore = b => {
  let score = 0;
  for (let r = 0; r < BOARD; r++) {
    for (let c = 0; c < BOARD; c++) {
      if (b[r][c]) {

        if (r > 0 && b[r-1][c]) score += 5;
        if (r < BOARD-1 && b[r+1][c]) score += 5;
        if (c > 0 && b[r][c-1]) score += 5;
        if (c < BOARD-1 && b[r][c+1]) score += 5;
      }
    }
  }
  return score;
};

const smoothness = b => {
  let penalty = 0;
  for (let c = 0; c < BOARD - 1; c++) {
    let height1 = 0, height2 = 0;
    for (let r = 0; r < BOARD; r++) {
      if (b[r][c] && height1 === 0) height1 = BOARD - r;
      if (b[r][c+1] && height2 === 0) height2 = BOARD - r;
    }
    penalty += Math.abs(height1 - height2);
  }
  return penalty * 15; 
};

const rectangleBonus = b => {
  let bonus = 0;

  for (let startR = 0; startR < BOARD; startR++) {
    for (let startC = 0; startC < BOARD; startC++) {
      if (!b[startR][startC]) continue; 

      for (let height = 2; height <= 5; height++) {
        for (let width = 2; width <= 5; width++) {

          if (startR + height > BOARD || startC + width > BOARD) continue;

          let isRectangle = true;
          for (let r = startR; r < startR + height && isRectangle; r++) {
            for (let c = startC; c < startC + width; c++) {
              if (!b[r][c]) {
                isRectangle = false;
                break;
              }
            }
          }

          if (isRectangle) {
            const area = height * width;
            const isSquare = height === width;

            bonus += Math.pow(area, 1.5); 

            if (isSquare) bonus += area * 20; 

            if (height === 3 && width === 3) bonus += 300;
          }
        }
      }
    }
  }

  return bonus;
};

const scoreBoard = (b, lines) => {
  return lines * 50000             
       - 2 * centrePenalty(b)         
       - holes(b) * 250           
       + 0.7 * adjacencyScore(b)        
       - smoothness(b)            
       + 0.5 * rectangleBonus(b);       
};

const place = (board, piece, row, col) => {
  const b = clone(board);
  const placedCells = []; 

  for (let r = 0; r < piece.length; r++)
    for (let c = 0; c < piece[0].length; c++)
      if (piece[r][c]) {
        const rr = row + r, cc = col + c;
        if (rr < 0 || rr >= BOARD || cc < 0 || cc >= BOARD || b[rr][cc]) return null;
        b[rr][cc] = true;
        placedCells.push([rr, cc]); 
      }

  const lines = clearLines(b);
  console.log(`place: Cleared ${lines} lines.`); 
  return { board: b, lines, placedCells };
};

function generateSequences(board, pieces) {
  const queue = [{ board, seq: [], remaining: pieces }];
  const out = [];
  const CLEARLY_GOOD_THRESHOLD = 3; 

  while (queue.length > 0 && out.length < SEQ_CAP) {
    const { board: bd, seq, remaining } = queue.shift();

    if (remaining.length === 0) {
      out.push(seq);
      continue;
    }

    let hitCapLimit = false;

    for (let idx = 0; idx < remaining.length; idx++) {
      const p = remaining[idx];

      for (let r = 0; r < BOARD; r++) {
        for (let c = 0; c < BOARD; c++) {
          const res = place(bd, p, r, c);
          if (!res) continue;

          if (res.lines >= CLEARLY_GOOD_THRESHOLD) {
            console.log(`generateSequences: Found 'clearly good' move (cleared ${res.lines} lines). Attempting to complete sequence.`);

            let newSeq = [...seq, {
              idx,
              board: res.board,
              piece: p,
              row: r,
              col: c,
              placedCells: res.placedCells,
              lines: res.lines
            }];
            let currentBoard = res.board;
            let canComplete = true;

            const nextRemaining = remaining.filter((_, i) => i !== idx);

            for (let piece of nextRemaining) {
              let bestPlacement = null;
              let bestPlacementScore = -Infinity;
              for (let rr = 0; rr < BOARD; rr++) {
                for (let cc = 0; cc < BOARD; cc++) {
                  const placement = place(currentBoard, piece, rr, cc);
                  if (placement) {
                    const sc = scoreBoard(placement.board, placement.lines);
                    if (sc > bestPlacementScore) {
                      bestPlacementScore = sc;
                      bestPlacement = {
                        piece,
                        row: rr,
                        col: cc,
                        board: placement.board,
                        placedCells: placement.placedCells,
                        lines: placement.lines
                      };
                    }
                  }
                }
              }
              if (!bestPlacement) {
                canComplete = false;
                break;
              }
              newSeq.push(bestPlacement);
              currentBoard = bestPlacement.board;
            }

            if (canComplete && newSeq.length === seq.length + 1 + nextRemaining.length) {
              return [newSeq];
            }

          }

          const nextRemaining = remaining.filter((_, i) => i !== idx);
          const nextSeq = [...seq, {
            idx,
            board: res.board,
            piece: p,
            row: r,
            col: c,
            placedCells: res.placedCells,
            lines: res.lines
          }];
          queue.push({ board: res.board, seq: nextSeq, remaining: nextRemaining });
          if (queue.length + out.length >= SEQ_CAP) {
            console.log(`generateSequences: SEQ_CAP (${SEQ_CAP}) reached.`);
            hitCapLimit = true;
            break;
          }
        }
        if (hitCapLimit) break;
      }
      if (hitCapLimit) break;
    }
  }
  console.log(`generateSequences: Finished search. Found ${out.length} complete sequences.`);
  return out;
}

function rollout(startBoard) {
  let b = clone(startBoard), score = 0, totalLines = 0;
  for (let i = 0; i < FUTURE_ROUNDS * 3; i++) {
    const piece = samplePiece();
    let placed = false;
    let bestPlacement = null, bestScore = -Infinity;

    for (let r = 0; r < BOARD; r++) {
      for (let c = 0; c < BOARD; c++) {
        const res = place(b, piece, r, c);
        if (res) {
          const placementScore = scoreBoard(res.board, res.lines);
          if (placementScore > bestScore) {
            bestScore = placementScore;
            bestPlacement = res;
          }
        }
      }
    }

    if (bestPlacement) {
      b = bestPlacement.board;
      score += bestScore;
      totalLines += bestPlacement.lines;
      placed = true;
    }

    if (!placed) break;
  }

  return score + (totalLines * 5000);
}

function bestTrio(board, trio) {
  const seqs = generateSequences(board, trio);
  let bestSeq = null;
  let bestScore = -Infinity;

  const IMMEDIATE_LINE_CLEAR_BONUS_PER_LINE = 1000000; 

  seqs.forEach(seq => {
    const endBoard = seq[seq.length - 1].board;

    let totalLinesInSequence = 0;
    seq.forEach(move => {
      if (move.lines) {
        totalLinesInSequence += move.lines;
      }
    });
    console.log(`  Calculated totalLinesInSequence: ${totalLinesInSequence}`)

    const immediateScore = totalLinesInSequence * IMMEDIATE_LINE_CLEAR_BONUS_PER_LINE;

    let totalRolloutScore = 0;
    for (let k = 0; k < ROLLOUTS; k++) {
      totalRolloutScore += rollout(endBoard); 
    }
    const avgRolloutScore = (ROLLOUTS > 0) ? (totalRolloutScore / ROLLOUTS) : 0;

    const finalScore = immediateScore + avgRolloutScore;

    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestSeq = seq;
    }
  });
  return bestSeq;
}

export default function BlockBlastAI() {
  const [board, setBoard] = useState(grid(BOARD, BOARD));
  const [designer, setDesigner] = useState(grid(DESIGN, DESIGN));
  const [pool, setPool] = useState([]);
  const [active, setActive] = useState([]);
  const [msg, setMsg] = useState('');
  const [animatingCells, setAnimatingCells] = useState([]);  
  const [clearingLines, setClearingLines] = useState([]); 
  const [isAnimating, setIsAnimating] = useState(false); 

  const toggleCell = (r, c) => {
    if (isAnimating) return; 
    setBoard(b => { const n = clone(b); n[r][c] = !n[r][c]; return n; });
  };

  const toggleDesigner = (r, c) => setDesigner(d => { const n = clone(d); n[r][c] = !n[r][c]; return n; });

  const trimPiece = g => {
    let minR = g.length, maxR = -1, minC = g[0].length, maxC = -1;
    g.forEach((row, r) => row.forEach((cell, c) => { if (cell) { if (r < minR) minR = r; if (r > maxR) maxR = r; if (c < minC) minC = c; if (c > maxC) maxC = c; } }));
    if (maxR === -1) return null;
    const out = [];
    for (let r = minR; r <= maxR; r++) out.push(g[r].slice(minC, maxC + 1));
    return out;
  };

  const addPiece = () => {
    const p = trimPiece(designer);
    if (!p) return setMsg('Draw something');
    setPool(pl => [...pl, p]);
    setDesigner(grid(DESIGN, DESIGN));
    setMsg('Piece added');
  };

  const addActive = idx => setActive(a => (a.length < 3 ? [...a, pool[idx]] : a));
  const removeActive = idx => setActive(a => a.filter((_, i) => i !== idx));

  const findLinesToClear = (b) => {
    const lines = [];

    for (let r = 0; r < BOARD; r++) {
      if (b[r].every(Boolean)) {
        lines.push({ type: 'row', index: r });
      }
    }

    for (let c = 0; c < BOARD; c++) {
      if (b.every(r => r[c])) {
        lines.push({ type: 'col', index: c });
      }
    }

    return lines;
  };

  const animateClearLines = (b, linesToClear) => {
    return new Promise(resolve => {
      if (linesToClear.length === 0) {
        resolve(b);
        return;
      }

      setClearingLines(linesToClear);

      setTimeout(() => {

        const newBoard = clone(b);
        linesToClear.forEach(line => {
          if (line.type === 'row') {
            newBoard[line.index].fill(false);
          } else {
            for (let r = 0; r < BOARD; r++) {
              newBoard[r][line.index] = false;
            }
          }
        });

        setClearingLines([]);
        resolve(newBoard);
      }, ANIMATION_DELAY);
    });
  };

  const animatePlacement = async (startBoard, piece, row, col) => {
    return new Promise(resolve => {

      const result = place(startBoard, piece, row, col);
      if (!result) {
        resolve(null);
        return;
      }

      setAnimatingCells(result.placedCells);

      setTimeout(async () => {
        setAnimatingCells([]);

        const linesToClear = findLinesToClear(result.board);

        const finalBoard = await animateClearLines(result.board, linesToClear);

        resolve({ 
          board: finalBoard, 
          lines: linesToClear.length
        });
      }, ANIMATION_DELAY);
    });
  };

  const aiMove = async () => {
    if (isAnimating) return;
    if (active.length !== 3) return setMsg('Need 3 active pieces');

    setIsAnimating(true);
    setMsg('Thinking…');

    setTimeout(async () => {
      const seq = bestTrio(board, active);
      if (!seq) { 
        setMsg('No valid placements'); 
        setIsAnimating(false);
        return; 
      }

      setMsg(`Found optimal sequence (${Math.min(SEQ_CAP, seq.length)} evaluated)`);

      let currentBoard = board;

      for (let i = 0; i < seq.length; i++) {
        const move = seq[i];
        setMsg(`Placing piece ${i+1} of ${seq.length}...`);

        const result = await animatePlacement(currentBoard, move.piece, move.row, move.col);
        if (!result) break;

        currentBoard = result.board;
        setBoard(currentBoard);
      }

      setActive([]);
      setMsg(`AI placed trio (${seq.length} moves)`);
      setIsAnimating(false);
    }, 10);
  };

  const Cell = ({ r, c, f }) => {

    const isAnimating = animatingCells.some(([ar, ac]) => ar === r && ac === c);

    const isClearing = clearingLines.some(line => 
      (line.type === 'row' && line.index === r) || 
      (line.type === 'col' && line.index === c)
    );

    return (
      <div 
        onClick={() => toggleCell(r, c)} 
        style={{ 
          width: 32, 
          height: 32, 
          background: isClearing ? '#ff6b6b' : isAnimating ? '#2ecc71' : f ? '#3498db' : '#e0e0e0', 
          border: '1px solid #555', 
          boxSizing: 'border-box', 
          cursor: isAnimating ? 'default' : 'pointer',
          transition: 'background-color 0.3s ease',
          animation: isAnimating ? 'pulse 0.8s' : isClearing ? 'fadeOut 0.8s' : 'none'
        }} 
      />
    );
  };

  const DCell = ({ f, on }) => <div onClick={on} style={{ width: 24, height: 24, background: f ? '#2ecc71' : '#e0e0e0', border: '1px solid #555', boxSizing: 'border-box', cursor: 'pointer' }} />;
  const Prev = ({ p }) => <div style={{ display: 'grid', gridTemplateColumns: `repeat(${p[0].length}, 12px)`, gap: 2 }}>{p.flatMap((row, r) => row.map((v, c) => <div key={r + '-' + c} style={{ width: 12, height: 12, background: v ? '#3498db' : '#ccc' }} />))}</div>;

  useEffect(() => {

    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0% { background-color: #2ecc71; transform: scale(1); }
        50% { background-color: #27ae60; transform: scale(1.1); }
        100% { background-color: #2ecc71; transform: scale(1); }
      }

      @keyframes fadeOut {
        0% { background-color: #ff6b6b; opacity: 1; }
        50% { background-color: #ff8787; opacity: 1; }
        100% { background-color: #ff6b6b; opacity: 0.5; }
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif' }}>
      <h3>Block Blast AI</h3>

      {}
      <div style={{ marginTop: 12 }}>
        <strong>Board</strong>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${BOARD}, 32px)`, gap: 2, marginTop: 6 }}>
          {board.map((row, r) => row.map((f, c) => <Cell key={r + '-' + c} r={r} c={c} f={f} />))}
        </div>
      </div>

      {}
      <div style={{ marginTop: 20 }}>
        <strong>Design piece</strong>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${DESIGN}, 24px)`, gap: 2, marginTop: 6 }}>
          {designer.map((row, r) => row.map((f, c) => <DCell key={'d' + r + c} f={f} on={() => toggleDesigner(r, c)} />))}
        </div>
        <button onClick={addPiece} style={{ marginTop: 6 }}>Add to Pool</button>
      </div>

      {}
      <div style={{ display: 'flex', gap: 24, marginTop: 20 }}>
        <div>
          <strong>Pool</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {pool.map((p, i) => <div key={'p' + i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Prev p={p} /><button onClick={() => addActive(i)} disabled={isAnimating}>Add</button></div>)}
          </div>
        </div>
        <div>
          <strong>Active ({active.length}/3)</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {active.map((p, i) => <div key={'a' + i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Prev p={p} /><span>#{i + 1}</span>
              <button
                onClick={() => removeActive(i)}
                disabled={isAnimating}          // optional: lock while animating
                style={{ marginLeft: 6 }}
              >
                ✖
              </button>
            </div>)}
          </div>
        </div>
      </div>

      {}
      <div style={{ marginTop: 20 }}>
        <button onClick={aiMove} disabled={isAnimating || active.length !== 3} style={{ opacity: isAnimating ? 0.6 : 1 }}>
          {isAnimating ? 'Animating...' : 'AI Move'}
        </button>
        <span style={{ marginLeft: 10 }}>{msg}</span>
      </div>
    </div>
  );
}