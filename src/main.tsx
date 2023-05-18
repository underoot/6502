import React, { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulator } from './'; 

type RunnerState = {
  memory: Uint8Array;
  registers: Uint8Array;
}

class Runner {
  simulator = new Simulator();
  inited = false;
  data: Uint8Array | null = null;

  subId = 0;
  subs = new Map<number, (state: RunnerState) => void>();

  onChange(cb: (state: RunnerState) => void) {
    this.subs.set(this.subId++, cb);
    return this.subId - 1;
  }

  offChange(id: number) {
    this.subs.delete(id);
  }

  notify() {
    const state: RunnerState = {
      memory: this.simulator.getMemory(),
      registers: this.simulator.getRegisters(),
    };

    for (const cb of this.subs.values()) {
      cb(state);
    }
  }

  run(data: Uint8Array) {
    const initialSong = data[7] + 15;

    this.simulator.ops[0xA9](initialSong - 1);
    this.simulator.ops[0xA2](data[0x7A] & 0b10000000 ? 0x01 : 0x00);
    this.simulator.fill(0x0000, 0x0800, 0);
    this.simulator.fill(0x6000, 0x8000, 0);
    this.simulator.fill(0x4000, 0x4014, 0);
    this.simulator.write([0x0F], 0x4015);
    this.simulator.set(0x17, 0x40, 0, 0x40);

    const loadAddress = data[8] | (data[9] << 8);

    this.simulator.ops[0x4C](data[10], data[11]);

    this.simulator.write([...data.slice(0x0080, data.length)], loadAddress)

    this.notify();

    this.data = data;
  }

  step() {
    let pc = this.simulator.getProgramCounter();
    const opcode = this.simulator.get(pc & 0xFF, pc >> 8);
    const argsLength = this.simulator.ops[opcode].length;
    const args = [];

    this.simulator.incProgramCounter();

    if (this.simulator.codeToName[opcode] === 'RTS' && !this.inited && this.data) {
      this.inited = true;
      this.simulator.ops[0x4C](this.data[12], this.data[13]);
      console.log("Inited");
      this.notify();
      return;
    }


    for (let i = 0; i < argsLength; i++) {
      pc = this.simulator.getProgramCounter();
      args.push(this.simulator.get(pc & 0xFF, pc >> 8));
      this.simulator.incProgramCounter();
    }

    this.simulator.ops[opcode](...args);
    this.notify();
  }
}

const registerIndexToName = (index: number) => {
  switch (index) {
    case 0:
      return "PC";
    case 1:
      return "PC";
    case 2:
      return "AC";
    case 3:
      return "X";
    case 4:
      return "Y";
    case 5:
      return "SR";
    case 6:
      return "SP";
    default:
      return "Unknown";
  }
};

const App = () => {
  const runner = useRef(new Runner()).current;
  const [memory] = React.useState<Uint8Array>(runner.simulator.getMemory());
  const [registers] = React.useState<Uint8Array>(runner.simulator.getRegisters());
  const [monitorStart, setMonitorStart] = React.useState(0x0000);
  const [monitorEnd, setMonitorEnd] = React.useState(0x0100);
  const monitorStartRef = useRef<HTMLInputElement>(null);
  const monitorEndRef = useRef<HTMLInputElement>(null);
  const [speed, setSpeed] = React.useState(60);
  const [automaticRun, setAutomaticRun] = React.useState(false);
  const [stopOnCycle, setStopOnCycle] = React.useState(false);
  const [stopCycle, setStopCycle] = React.useState(0);
  const [_lastUpdateTS, setLastUpdateTS] = React.useState(Date.now());

  useEffect(() => {
    monitorStartRef.current && (monitorStartRef.current.value = monitorStart.toString(16));
    monitorEndRef.current && (monitorEndRef.current.value = monitorEnd.toString(16));
  }, [monitorStart, monitorEnd]);

  useEffect(() => {
    runner.onChange(() => {
      setLastUpdateTS(Date.now());
    });
  });

  const onRunAutomaticallyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAutomaticRun(e.target.checked);
  };

  const onSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSpeed(parseInt(e.target.value));
  };

  const onStopOnCycleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStopOnCycle(e.target.checked);
  };

  const onStopCycleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStopCycle(parseInt(e.target.value));
  };

  useEffect(() => {
    if (stopOnCycle && runner.simulator.cycle >= stopCycle) {
      setAutomaticRun(false);
    }
  }, [stopOnCycle, stopCycle, runner.simulator.cycle]);

  useEffect(() => {
    if (automaticRun) {
      const interval = setInterval(() => {
        runner.step();
      }, 1000 / speed);

      return () => {
        clearInterval(interval);
      };
    }
  }, [automaticRun, speed]);

  const onMonitorClick = () => {
    const start = parseInt(monitorStartRef.current?.value || '0', 16);
    const end = parseInt(monitorEndRef.current?.value || '0', 16);

    setMonitorStart(start);
    setMonitorEnd(end);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();

    reader.addEventListener('loadend', () => {
      const buffer = reader.result as ArrayBuffer;
      const data = new Uint8Array(buffer);

      const str = [...data.slice(0, 4)].map((v: number) => String.fromCharCode(v)).join('');

      if (str !== 'NESM') {
        console.log('Not a NES file!');
        return;
      }

      console.log(data[4]);

      console.log("Version: ", data[5]);
      console.log("Number of songs: ", data[6]);
      console.log("Starting song: ", data[7]);

      const loadAddress = data[8] | (data[9] << 8);
      const initAddress = data[10] | (data[11] << 8);
      const playAddress = data[12] | (data[13] << 8);

      console.log("Load address: ", "$" + loadAddress.toString(16));
      console.log("Init address: ", "$" + initAddress.toString(16));
      console.log("Play address: ", "$" + playAddress.toString(16));

      let nameOfSong = "";

      for (let i = 0; i < 32; i++) {
        const char = data[14 + i];
        if (char === 0) {
          break;
        }
        nameOfSong += String.fromCharCode(char);
      }

      console.log("Name of song: ", nameOfSong);

      let artistInfo = "";

      for (let i = 0; i < 32; i++) {
        const char = data[46 + i];
        if (char === 0) {
          break;
        }
        artistInfo += String.fromCharCode(char);
      }

      console.log("Artist info: ", artistInfo);

      let copyright = "";

      for (let i = 0; i < 32; i++) {
        const char = data[78 + i];
        if (char === 0) {
          break;
        }
      }

      console.log("Copyright: ", copyright);

      const playSpeedNTSC = data[0x6E] | (data[0x6F] << 8);

      console.log("Play speed (NTSC): ", playSpeedNTSC);

      const bankSwitchInit = data.slice(0x70, 0x7A);

      console.log("Bank switch init: ", bankSwitchInit);

      const playSpeedPAL = data[0x78] | (data[0x79] << 8);

      console.log("Play speed (PAL): ", playSpeedPAL);

      const modeBits = data[0x7A];

      console.log("Mode bits: ", modeBits.toString(2));

      const extraSoundSupportBits = data[0x7B];

      console.log("Extra sound support bits: ", extraSoundSupportBits.toString(2));

      const programData = data.slice(0x7D, 0x80);

      console.log("Program data: ", programData);

      runner.run(data);
    });


    reader.readAsArrayBuffer(file);
  };

  let memoryDOM = [];

  for (let i = monitorStart; i < monitorEnd; i += 16) {
    const row = memory.slice(i, i + 16);
    memoryDOM.push(
      <div key={i} className="data">
        <div className="data__address">{i.toString(16).padStart(4, "0").toUpperCase()}</div>
        {[...row].map((v, ib) => (
          <div key={ib} className={`data__tile ${(i + ib) === (registers[0] | registers[1] << 8) ? 'data__tile_active' : ''}`} title={runner.simulator.codeToName[v]}>{v.toString(16).padStart(2, "0").toUpperCase()}</div>
        ))}
      </div>
    );
  }

  let soundMemoryDOM = [];

  for (let i = 0x4000; i < 0x4018; i += 16) {
    const row = memory.slice(i, i + 16);
    soundMemoryDOM.push(
      <div key={i} className="data">
        <div className="data__address">{i.toString(16).padStart(4, "0").toUpperCase()}</div>
        {[...row].map((v, i) => (
          <div key={i} className="data__tile">{v.toString(16).padStart(2, "0").toUpperCase()}</div>
        ))}
      </div>
    );
  }

  return (
    <div className="main">
      <div>
        <input type="file" onChange={onChange} />
        <h2>Memory</h2>
        <div className="memory">
          {memoryDOM}
        </div>
      </div>
      <div>
        <div className="right-side">
          <h2>Cycle</h2>
          <div className="cycle">{runner.simulator.cycle}</div>
          <h2>Monitor control</h2>
          <div className="monitor-control">
            <input ref={monitorStartRef} />
            <input ref={monitorEndRef} />
            <button onClick={onMonitorClick}>Update</button>
          </div>
          <h2>Registers</h2>
          <table className="registers">
            <thead>
              <tr>
                {[...registers].map((_, i) => (
                  <td key={i} className="registers__register__name">{registerIndexToName(i)}</td>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {[...registers].map((v, i) => (
                  i === 5 
                    ? <td key={i} className="registers__register__value">{v.toString(2).padStart(8, "0")}</td>
                    : <td key={i} className="registers__register__value">{v.toString(16).padStart(2, "0").toUpperCase()}</td>
                ))}
              </tr>
            </tbody>
          </table>
          <h2>Sound memory</h2>
          <div className="memory">
            {soundMemoryDOM}
          </div>
          <button onClick={() => runner.step()}>Step</button>
          <div>
            <label>
              Count per second
              <input type="number" value={speed} onChange={onSpeedChange} />
            </label>
          </div>
          <div>
            <label>
              Run automatically
              <input type="checkbox" checked={automaticRun} onChange={onRunAutomaticallyChange} />
            </label>
          </div>
          <div>
            <label>
              Stop cycle
              <input type="number" value={stopCycle} onChange={onStopCycleChange} />
            </label>
          </div>
          <div>
            <label>
              Stop on cycle 
              <input type="checkbox" checked={stopOnCycle} onChange={onStopOnCycleChange} />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
};

const el = document.getElementById('root');

if (!el) {
  throw new Error('Root element not found');
}

const root = createRoot(el);

root.render(
  <StrictMode>
    <App />
  </StrictMode>
);