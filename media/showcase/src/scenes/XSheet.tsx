import {AbsoluteFill} from 'remotion';
import {fonts} from '../design';
import {XHEADER, xsheetRow} from '../library/animation/xsheet';
import {settled} from '../library/tokens';
import {xstateOf} from './animaticPlan';

/** A page of the exposure sheet as a still: `count` rows from frame `from`. The whole sheet is v3/xsheet.html (scripts/animation/xsheet.mjs). */
export const XSheetPage: React.FC<{from: number; count: number}> = ({from, count}) => {
  const rows = Array.from({length: count}, (_, i) => xsheetRow(xstateOf(from + i)));
  return (
    <AbsoluteFill style={{background: settled.field, color: settled.kit.light, fontFamily: fonts.mono, fontSize: 12.5, padding: 20}}>
      <div style={{fontFamily: fonts.sans, fontSize: 20, fontWeight: 600, marginBottom: 8}}>Exposure sheet · frames {from}-{from + count - 1}</div>
      <table style={{borderCollapse: 'collapse', width: '100%'}}>
        <thead>
          <tr>{XHEADER.map((h) => <th key={h} style={{textAlign: 'left', color: settled.kit.main2, padding: '2px 8px', borderBottom: `1px solid ${settled.kit.main2}`}}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}>{r.map((c, i) => <td key={i} style={{padding: '1px 8px', whiteSpace: 'nowrap'}}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </AbsoluteFill>
  );
};
