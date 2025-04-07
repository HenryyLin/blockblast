import React, { useState, useEffect, useCallback, useRef } from 'react';

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
  [[1,0],[0,1]],
  [[1,0,0],[0,1,0],[0,0,1]],
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
  const newBoard = clone(b);

  for (let r = 0; r < BOARD; r++) {
    if (newBoard[r].every(Boolean)) {
      linesToClear.push({ type: 'row', index: r });
    }
  }
  for (let c = 0; c < BOARD; c++) {
    if (newBoard.every(r => r[c])) {
      linesToClear.push({ type: 'col', index: c });
    }
  }

  linesToClear.forEach(line => {
    if (line.type === 'row') {
      newBoard[line.index].fill(false);
    } else {
      for (let r = 0; r < BOARD; r++) {
        newBoard[r][line.index] = false;
      }
    }
  });

  return { clearedBoard: newBoard, linesClearedCount: linesToClear.length, linesDetail: linesToClear };
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

const scoreBoard = (b, linesClearedCount) => {
  return linesClearedCount * 50000
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

  const { clearedBoard, linesClearedCount, linesDetail } = clearLines(b);
  // console.log(`place: Cleared ${linesClearedCount} lines.`);
  return { boardBeforeClear: b, board: clearedBoard, lines: linesClearedCount, linesDetail: linesDetail, placedCells };
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
            // console.log(`generateSequences: Found 'clearly good' move (cleared ${res.lines} lines). Attempting greedy completion.`);
            let currentBoard = res.board;
            let currentSeq = [...seq, {
                idx, boardBeforeClear: res.boardBeforeClear, board: res.board, piece: p, row: r, col: c, placedCells: res.placedCells, lines: res.lines, linesDetail: res.linesDetail
            }];
            let canCompleteGreedy = true;
            const nextRemaining = remaining.filter((_, i) => i !== idx);

            for(let remPieceIdx = 0; remPieceIdx < nextRemaining.length; remPieceIdx++){
                const remPiece = nextRemaining[remPieceIdx];
                let bestPlacementForRem = null;
                let bestScoreForRem = -Infinity;

                for (let rr = 0; rr < BOARD; rr++) {
                    for (let cc = 0; cc < BOARD; cc++) {
                        const placement = place(currentBoard, remPiece, rr, cc);
                        if (placement) {
                            const sc = scoreBoard(placement.board, placement.lines);
                            if (sc > bestScoreForRem) {
                                bestScoreForRem = sc;
                                bestPlacementForRem = {
                                    idx: -1,
                                    boardBeforeClear: placement.boardBeforeClear,
                                    board: placement.board,
                                    piece: remPiece, row: rr, col: cc,
                                    placedCells: placement.placedCells, lines: placement.lines, linesDetail: placement.linesDetail
                                };
                            }
                        }
                    }
                }

                if(!bestPlacementForRem){
                    canCompleteGreedy = false;
                    break;
                }
                currentSeq.push(bestPlacementForRem);
                currentBoard = bestPlacementForRem.board;
            }

            if(canCompleteGreedy){
                // console.log("Greedy completion successful, returning early.");
                return [currentSeq]; 
            }
          }

          const nextRemainingStandard = remaining.filter((_, i) => i !== idx);
          const nextSeqStandard = [...seq, {
            idx,
            boardBeforeClear: res.boardBeforeClear,
            board: res.board,
            piece: p,
            row: r,
            col: c,
            placedCells: res.placedCells,
            lines: res.lines,
            linesDetail: res.linesDetail
          }];
          queue.push({ board: res.board, seq: nextSeqStandard, remaining: nextRemainingStandard });

          if (queue.length + out.length >= SEQ_CAP) {
            // console.log(`generateSequences: SEQ_CAP (${SEQ_CAP}) reached.`);
            hitCapLimit = true;
            break;
          }
        }
        if (hitCapLimit) break;
      }
      if (hitCapLimit) break;
    }
  }
  // console.log(`generateSequences: Finished search. Found ${out.length} complete sequences.`);
  return out;
}


function rollout(startBoard) {
  let b = clone(startBoard), score = 0, totalLines = 0;
  for (let i = 0; i < FUTURE_ROUNDS * 3; i++) {
    const piece = samplePiece();
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
    } else {
      break;
    }
  }
  return score + (totalLines * 5000);
}

function bestTrio(board, trio) {
  const seqs = generateSequences(board, trio);
  if (seqs.length === 0) return null;

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
    // console.log(`  Evaluated sequence clearing ${totalLinesInSequence} lines.`);

    const immediateScore = totalLinesInSequence * IMMEDIATE_LINE_CLEAR_BONUS_PER_LINE;

    let totalRolloutScore = 0;
    for (let k = 0; k < ROLLOUTS; k++) {
      totalRolloutScore += rollout(endBoard);
    }
    const avgRolloutScore = (ROLLOUTS > 0) ? (totalRolloutScore / ROLLOUTS) : scoreBoard(endBoard, 0);

    const finalScore = immediateScore + avgRolloutScore;

    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestSeq = seq;
    }
  });
  return bestSeq;
}

export default function BlockBlastAI() {
  const [board, setBoard] = useState(() => grid(BOARD, BOARD));
  const [designer, setDesigner] = useState(() => grid(DESIGN, DESIGN));
  const [pool, setPool] = useState([]);
  const [active, setActive] = useState([]);
  const [msg, setMsg] = useState('Add pieces and AI Move or Start AI Simulation.');
  const [animatingCells, setAnimatingCells] = useState([]);
  const [clearingLines, setClearingLines] = useState([]);
  const [isAnimating, setIsAnimating] = useState(false);

  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationTurns, setSimulationTurns] = useState(0);
  const [totalLinesClearedInSim, setTotalLinesClearedInSim] = useState(0);

  const boardRef = useRef(board);
  useEffect(() => {
      boardRef.current = board;
  }, [board]);

  const simulationStatusRef = useRef({ isSimulating: false, turns: 0, lines: 0 });
   useEffect(() => {
      simulationStatusRef.current = {
          isSimulating: isSimulating,
          turns: simulationTurns,
          lines: totalLinesClearedInSim,
      };
   }, [isSimulating, simulationTurns, totalLinesClearedInSim]);

  const toggleCell = (r, c) => {
    if (isAnimating || isSimulating) return;
    setBoard(b => { const n = clone(b); n[r][c] = !n[r][c]; return n; });
  };

  const toggleDesigner = (r, c) => {
     if (isSimulating) return;
     setDesigner(d => { const n = clone(d); n[r][c] = !n[r][c]; return n; });
  };

  const trimPiece = g => {
    let minR = g.length, maxR = -1, minC = g[0].length, maxC = -1;
    g.forEach((row, r) => row.forEach((cell, c) => { if (cell) { if (r < minR) minR = r; if (r > maxR) maxR = r; if (c < minC) minC = c; if (c > maxC) maxC = c; } }));
    if (maxR === -1) return null;
    const out = [];
    for (let r = minR; r <= maxR; r++) out.push(g[r].slice(minC, maxC + 1));
    return out;
  };

  const addPiece = () => {
    if (isSimulating) return;
    const p = trimPiece(designer);
    if (!p) return setMsg('Draw something');
    setPool(pl => [...pl, p]);
    setDesigner(grid(DESIGN, DESIGN));
    setMsg('Piece added to pool.');
  };

   const addActive = idx => {
       if (isSimulating || isAnimating || active.length >= 3) return;
       setActive(a => [...a, pool[idx]]);
   };

   const removeActive = idx => {
       if (isSimulating || isAnimating) return;
       setActive(a => a.filter((_, i) => i !== idx));
   };

  const findLinesToClearForAnimation = (b) => {
    const lines = [];
    for (let r = 0; r < BOARD; r++) { if (b[r].every(Boolean)) lines.push({ type: 'row', index: r }); }
    for (let c = 0; c < BOARD; c++) { if (b.every(r => r[c])) lines.push({ type: 'col', index: c }); }
    return lines;
  };

   const animateClearLines = useCallback((boardAfterPlacement, linesDetail) => {
    return new Promise(resolve => {
      if (!linesDetail || linesDetail.length === 0) {
        resolve({ board: boardAfterPlacement, linesCleared: 0 });
        return;
      }
      setIsAnimating(true);
      setClearingLines(linesDetail);

      setTimeout(() => {
        const { clearedBoard, linesClearedCount } = clearLines(boardAfterPlacement);
        setClearingLines([]);
        setIsAnimating(false);
        resolve({ board: clearedBoard, linesCleared: linesClearedCount });
      }, ANIMATION_DELAY / 2);
    });
  }, []);

  const animatePlacement = useCallback(async (currentBoardState, piece, row, col) => {
      return new Promise(async resolve => {
          setIsAnimating(true);

          const placementResult = place(currentBoardState, piece, row, col);

          if (!placementResult) {
              setIsAnimating(false);
              resolve({ board: currentBoardState, linesCleared: 0, placed: false });
              return;
          }

          setAnimatingCells(placementResult.placedCells);

          await new Promise(res => setTimeout(res, ANIMATION_DELAY / 2));

          setAnimatingCells([]);

          const boardAfterPlace = placementResult.boardBeforeClear;
          const linesDetailForAnimation = placementResult.linesDetail;

          const clearResult = await animateClearLines(boardAfterPlace, linesDetailForAnimation);

          resolve({
              board: clearResult.board,
              linesCleared: clearResult.linesCleared,
              placed: true
          });
       });
  }, [animateClearLines]);


  const aiMove = async () => {
    if (isAnimating || isSimulating) return;
    if (active.length !== 3) return setMsg('Need 3 active pieces');

    setIsAnimating(true);
    setMsg('Thinking…');

    let seq = null; 

    try { 
        seq = await new Promise(resolve => {
            setTimeout(() => {
                const result = bestTrio(board, active);
                resolve(result);
            }, 10);
        });

        if (!seq) {
            setMsg('No valid placements found.');
        } else {
            setMsg(`Placing ${seq.length} pieces...`);
            let currentBoard = board;

            for (let i = 0; i < seq.length; i++) {
                const move = seq[i];
                setMsg(`Placing piece ${i+1} of ${seq.length}...`);

                const result = await animatePlacement(currentBoard, move.piece, move.row, move.col);

                if (!result || !result.placed) {
                    setMsg(`Error placing piece ${i+1}. Stopping sequence.`);
                    break;
                }
                currentBoard = result.board;
                setBoard(currentBoard); 
            }

             if (seq && seq.length > 0) {
                 setMsg(`Finished placing pieces.`);
             }
            setActive([]);
        }

    } catch (error) {
        console.error("Error during aiMove execution:", error);
        setMsg("An error occurred during the AI move.");
        setActive([]);

    } finally {
        setIsAnimating(false);
    }
  };
  const handleClearBoard = () => {
    if (isAnimating || isSimulating) return;

    setBoard(grid(BOARD, BOARD));

    setAnimatingCells([]);
    setClearingLines([]);

    setMsg('Board cleared.');
  };


const runSimulationStep = useCallback(async () => {
      if (!simulationStatusRef.current.isSimulating) {
          if (isSimulating) setIsSimulating(false);
          if (isAnimating) setIsAnimating(false);
          if (active.length > 0) setActive([]);
          return;
      }

      if (PIECES.length < 3) {
          setMsg("Not enough unique pieces defined to draw 3 for simulation.");
          setIsSimulating(false);
          setIsAnimating(false);
          return;
      }
       const drawnPieces = [];
       const availablePieces = [...PIECES];
       while(drawnPieces.length < 3 && availablePieces.length > 0) {
           const randomIndex = Math.floor(Math.random() * availablePieces.length);
           drawnPieces.push(availablePieces.splice(randomIndex, 1)[0]);
       }
       if (drawnPieces.length < 3) {
           setMsg("Could not draw 3 pieces. Stopping simulation.");
            setIsSimulating(false);
            setIsAnimating(false);
            return;
       }

      setMsg(`Sim Turn ${simulationStatusRef.current.turns + 1}: Drawn 3 pieces. Thinking...`);
      setActive(drawnPieces);

       const seq = await new Promise(resolve => {
           setTimeout(() => {
               const result = bestTrio(boardRef.current, drawnPieces);
               resolve(result);
           }, 10);
       });

      if (!simulationStatusRef.current.isSimulating) {
           if (isSimulating) setIsSimulating(false);
           if (isAnimating) setIsAnimating(false);
           if (active.length > 0) setActive([]);
          return;
      }

      if (!seq) {
        setMsg(`Sim Turn ${simulationStatusRef.current.turns + 1}: GAME OVER! No valid placement. Final Score: ${simulationStatusRef.current.lines} lines.`);
        setActive([]);
        setIsSimulating(false);
        setIsAnimating(false);
        return;
      }

      let currentSimBoard = boardRef.current;
      let linesThisTurn = 0;

      for (let i = 0; i < seq.length; i++) {
           if (!simulationStatusRef.current.isSimulating) {
               if (isSimulating) setIsSimulating(false);
               if (isAnimating) setIsAnimating(false);
               if (active.length > 0) setActive([]);
               return;
            }

          const move = seq[i];
          setMsg(`Sim Turn ${simulationStatusRef.current.turns + 1}: Placing piece ${i+1} of ${seq.length}...`);

          const result = await animatePlacement(currentSimBoard, move.piece, move.row, move.col);

          if (!result || !result.placed) {
              setMsg(`Sim Turn ${simulationStatusRef.current.turns + 1}: ERROR placing piece ${i+1}. Stopping simulation.`);
              setIsSimulating(false);
              setIsAnimating(false);
              setActive([]);
              return;
          }

          currentSimBoard = result.board;
          linesThisTurn += result.linesCleared;
          setBoard(currentSimBoard);
      }

      const newTotalLines = simulationStatusRef.current.lines + linesThisTurn;
      const newTurnCount = simulationStatusRef.current.turns + 1;

      setTotalLinesClearedInSim(newTotalLines);
      setSimulationTurns(newTurnCount);
      setActive([]);

      setMsg(`Sim Turn ${newTurnCount}: Placed ${seq.length} pieces, cleared ${linesThisTurn} lines. Total Lines: ${newTotalLines}. Scheduling next turn...`);

      if (simulationStatusRef.current.isSimulating) {
           setTimeout(runSimulationStep, 50);
      } else {
           if (isSimulating) setIsSimulating(false);
           if (isAnimating) setIsAnimating(false);
           if (active.length > 0) setActive([]);
      }

  }, [animatePlacement, isAnimating, isSimulating]);

  const handleSimulationToggle = () => {
      if (!isSimulating) {
          // --- Start Simulation ---
          setIsSimulating(true);
          setBoard(grid(BOARD, BOARD));
          setSimulationTurns(0);
          setTotalLinesClearedInSim(0);
          setActive([]);
          setAnimatingCells([]);
          setClearingLines([]);
          simulationStatusRef.current = { isSimulating: true, turns: 0, lines: 0 };
          setIsAnimating(false);
          setMsg("Starting Simulation...");
          setTimeout(runSimulationStep, 100);
      } else {
          setIsSimulating(false); 
          simulationStatusRef.current.isSimulating = false;
          setActive([]);
          setIsAnimating(false);
          setMsg("Simulation stopped by user.");
      }
  };
  const Cell = ({ r, c, f }) => {
    const isCurrentlyAnimating = animatingCells.some(([ar, ac]) => ar === r && ac === c);
    const isCurrentlyClearing = clearingLines.some(line =>
        (line.type === 'row' && line.index === r) ||
        (line.type === 'col' && line.index === c)
    );

     let background = '#e0e0e0';
     if (f) background = '#3498db';
     if (isCurrentlyClearing) background = '#ff6b6b';
     if (isCurrentlyAnimating) background = '#2ecc71';

     let animationStyle = 'none';
     if (isCurrentlyAnimating) animationStyle = 'pulse 0.8s';

     const cursor = (isAnimating || isSimulating) ? 'default' : 'pointer';

     return (
       <div
         onClick={() => toggleCell(r, c)}
         style={{
           width: 32,
           height: 32,
           background: background,
           border: '1px solid #555',
           boxSizing: 'border-box',
           cursor: cursor,
           transition: 'background-color 0.3s ease',
           animation: animationStyle
         }}
       />
     );
  };

   const DCell = ({ f, on }) => (
       <div
           onClick={isSimulating ? null : on}
           style={{
               width: 24, height: 24,
               background: f ? '#2ecc71' : '#e0e0e0',
               border: '1px solid #555',
               boxSizing: 'border-box',
               cursor: isSimulating ? 'default' : 'pointer'
            }}
        />
    );

  const Prev = ({ p }) => <div style={{ display: 'grid', gridTemplateColumns: `repeat(${p[0].length}, 12px)`, gap: 2 }}>{p.flatMap((row, r) => row.map((v, c) => <div key={r + '-' + c} style={{ width: 12, height: 12, background: v ? '#3498db' : '#ccc' }} />))}</div>;

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0% { background-color: #2ecc71; transform: scale(1); }
        50% { background-color: #27ae60; transform: scale(1.1); }
        100% { background-color: #2ecc71; transform: scale(1); }
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

        <div style={{ marginTop: 12, marginBottom: 12, padding: 8, background: '#f0f0f0', border: '1px solid #ccc', color: '#333' }}>
            <strong>Simulation</strong><br/>
            <button onClick={handleSimulationToggle} disabled={isAnimating && !isSimulating}>
                {isSimulating ? 'Stop Simulation' : 'Start AI Simulation'}
            </button>
            {}
            <span style={{ marginLeft: 10, color: '#333' }}>
                Status: {isSimulating ? `Running Turn ${simulationTurns + 1}` : (isAnimating ? 'Animating...' : 'Idle')} |
                Total Turns: {simulationTurns} |
                Total Lines Cleared: {totalLinesClearedInSim}
            </span>
        </div>

        <div style={{ margin: "10px 0", minHeight: '1.2em', fontWeight: "bold", color: msg.includes("ERROR") || msg.includes("GAME OVER") ? 'red' : 'inherit' }}>{msg}</div>

       <div style={{ marginTop: 12, opacity: isSimulating ? 0.7 : 1, pointerEvents: isSimulating ? 'none' : 'auto' }}>
           <strong>Board</strong>
           <div style={{ display: 'grid', gridTemplateColumns: `repeat(${BOARD}, 32px)`, gap: 2, marginTop: 6 }}>
             {board.map((row, r) => row.map((f, c) => <Cell key={r + '-' + c} r={r} c={c} f={f} />))}
           </div>
            <div style={{marginTop: '8px'}}>
              <button onClick={handleClearBoard} disabled={isAnimating || isSimulating}>
                  Clear Board
              </button>
            </div>
       </div>

      <div style={{ marginTop: 20, opacity: isSimulating ? 0.7 : 1, pointerEvents: isSimulating ? 'none' : 'auto'  }}>
          <strong>Design piece</strong>
           <div style={{ display: 'grid', gridTemplateColumns: `repeat(${DESIGN}, 24px)`, gap: 2, marginTop: 6 }}>
             {designer.map((row, r) => row.map((f, c) => <DCell key={'d' + r + c} f={f} on={() => toggleDesigner(r, c)} />))}
           </div>
          <button onClick={addPiece} style={{ marginTop: 6 }} disabled={isSimulating}>Add to Pool</button>
      </div>

      <div style={{ display: 'flex', gap: 24, marginTop: 20 }}>
          <div>
              <strong>Pool</strong>
               <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, maxHeight: '200px', overflowY: 'auto' }}>
                 {pool.map((p, i) => <div key={'p' + i} style={{ display: 'flex', alignItems: 'center', gap: 6 }} ><Prev p={p} /><button onClick={() => addActive(i)} disabled={isAnimating || isSimulating || active.length >= 3}>Add</button></div>)}
               </div>
          </div>
          <div>
              <strong>Active ({active.length}/3)</strong>
               <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                 {active.map((p, i) => <div key={'a' + i} style={{ display: 'flex', alignItems: 'center', gap: 6 }} ><Prev p={p} /><span>#{i + 1}</span>
                     <button onClick={() => removeActive(i)} disabled={isAnimating || isSimulating} style={{ marginLeft: 6 }} >✖</button>
                 </div>)}
               </div>
          </div>
      </div>

      <div style={{ marginTop: 20 }}>
          <button onClick={aiMove} disabled={isAnimating || isSimulating || active.length !== 3} style={{ opacity: (isAnimating || isSimulating || active.length !== 3) ? 0.6 : 1 }}>
              {isAnimating && !isSimulating ? 'Animating...' : 'AI Move'}
          </button>
      </div>
    </div>
  );
}