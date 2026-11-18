import { useState } from 'react';
import {
  keyLabel, MAX_PRACTICE_KEYS, MIN_PRACTICE_KEYS, PRACTICE_PRESETS, PRACTICE_ROWS,
  practiceKeys, type PracticeConfig, type PracticePreset,
} from '../../../shared/practice';
import '../../practice.css';

export default function PracticeSettings({ value, onChange }: {
  value: PracticeConfig;
  onChange: (value: PracticeConfig) => void;
}) {
  const [status, setStatus] = useState('');
  const keys = practiceKeys(value);
  const custom = value.preset === 'custom';

  function toggleKey(key: string) {
    const selected = value.customKeys.includes(key);
    if (selected && keys.length <= MIN_PRACTICE_KEYS) {
      setStatus(`Keep at least ${MIN_PRACTICE_KEYS} keys to play chords and holds.`);
      return;
    }
    if (!selected && keys.length >= MAX_PRACTICE_KEYS) {
      setStatus(`Remove a key before adding another. Practice supports up to ${MAX_PRACTICE_KEYS} keys.`);
      return;
    }
    const customKeys = selected ? value.customKeys.filter(code => code !== key) : [...value.customKeys, key];
    setStatus(`${customKeys.length} keys selected.`);
    onChange({ ...value, customKeys });
  }

  return (
    <section className="practice-settings" aria-label="Practice keys">
      <label>
        Practice layout
        <select value={value.preset} onChange={event => {
          setStatus('');
          onChange({ ...value, preset: event.target.value as PracticePreset });
        }}>
          {Object.entries(PRACTICE_PRESETS).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}
        </select>
      </label>
      <p>{PRACTICE_PRESETS[value.preset].description}</p>
      <p>Each key has its own lane. Lane labels follow the keyboard rows from top to bottom.</p>
      <p className="practice-key-total">{keys.length} keys</p>
      <div className="practice-rows">
        {PRACTICE_ROWS.map(row => {
          const visibleKeys = custom ? row.keys : row.keys.filter(key => keys.includes(key));
          if (!visibleKeys.length) return null;
          return (
            <section key={row.name} aria-label={row.name}>
              <h3>{row.name}</h3>
              <div className="practice-keys">
                {visibleKeys.map(key => custom ? (
                  <button key={key} type="button" aria-label={`Key ${keyLabel(key)}`} aria-pressed={keys.includes(key)}
                    onClick={() => toggleKey(key)}>
                    {keyLabel(key)}
                  </button>
                ) : <kbd key={key}>{keyLabel(key)}</kbd>)}
              </div>
            </section>
          );
        })}
      </div>
      {custom && <p className="practice-status" role="status">{status || `Choose ${MIN_PRACTICE_KEYS} to ${MAX_PRACTICE_KEYS} keys.`}</p>}
    </section>
  );
}
