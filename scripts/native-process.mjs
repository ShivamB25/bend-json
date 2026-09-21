import {spawn} from 'node:child_process';
import {ROOT, ENV} from './tools.mjs';
import {strictDecode} from '../tests/support.mjs';

const describe = error => error ? {name:error.name,message:error.message || String(error),code:error.code,stack:error.stack} : null;

// One finite child, including its compiler descendants, is killed and reaped.
// RSS is an optional sampled ceiling, never a claim to observe the exact peak.
export function nativeProcess(command, args, {timeout = 5000, maxBuffer = 16 * 1024 * 1024, env = ENV, memory = null, caseIds = null, caseTimeout = 5000, onCaseEvent, onInvalidOutput} = {}) {
  const started = performance.now();
  return new Promise(resolveResult => {
    const out = [], err = [];
    const measured = {enabled:memory !== null,limitBytes:memory?.limitBytes,intervalMs:memory?.intervalMs,samples:0,maximumSampledRssBytes:0,exceeded:false,enforcement:'unverified',samplingError:null};
    const caseProgress = caseIds === null ? null : {expected:caseIds,started:0,completed:0,active:null,phase:'startup',complete:false,error:null,diagnostics:'',events:[],timeoutMs:caseTimeout};
    const progressDecoder = caseIds === null ? null : new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
    let progressBuffer = '', caseTimer, caseStarted = 0;
    let bytes = 0, error = null, timedOut = false, timeoutPhase = null, overflow = false, killError = null, settled = false, monitor;
    const child = spawn(command,args,{cwd:ROOT,env,detached:process.platform !== 'win32',stdio:['ignore','pipe','pipe']});
    const kill = () => {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid,'SIGKILL'); else child.kill('SIGKILL'); }
      catch (problem) { if (problem.code !== 'ESRCH') killError = describe(problem); }
    };
    const armCase = phase => {
      clearTimeout(caseTimer);
      caseProgress.phase = phase;
      caseTimer = setTimeout(() => { timedOut = true; timeoutPhase = phase; kill(); },caseTimeout);
    };
    const progressError = message => {
      caseProgress.error ||= message;
      kill();
    };
    const progressLine = line => {
      if (caseProgress.error) return;
      const marker = /^(START|END)\t([^\t\r\n]+)$/.exec(line);
      if (!marker) {
        if (/^(START|END)(?:\t|$)/.test(line)) progressError('Malformed construction progress marker');
        else caseProgress.diagnostics += line + '\n';
        return;
      }
      const [,kind,id] = marker, now = performance.now();
      if (kind === 'START') {
        if (caseProgress.active !== null || id !== caseIds[caseProgress.started]) return progressError(`Unexpected construction START ${id}`);
        caseProgress.active = id; caseProgress.started++; caseStarted = now;
        armCase('case');
      } else {
        if (caseProgress.active !== id || id !== caseIds[caseProgress.completed]) return progressError(`Unmatched construction END ${id}`);
        if (now-caseStarted > caseTimeout) { timedOut = true; timeoutPhase = 'case'; kill(); }
        caseProgress.completed++; caseProgress.active = null;
        armCase(caseProgress.completed === caseIds.length ? 'exit' : 'between-cases');
      }
      const record = {event:kind === 'START' ? 'start' : 'end',id,elapsedMs:now-started,...(kind === 'END' ? {caseElapsedMs:now-caseStarted} : {})};
      caseProgress.events.push(record);
      if (onCaseEvent) onCaseEvent(record);
    };
    const progressChunk = chunk => {
      try {
        progressBuffer += progressDecoder.decode(chunk,{stream:true});
        let newline;
        while ((newline = progressBuffer.indexOf('\n')) !== -1) {
          const line = progressBuffer.slice(0,newline);
          progressBuffer = progressBuffer.slice(newline+1);
          progressLine(line);
        }
      } catch (problem) { error ||= describe(problem); kill(); }
    };
    if (caseProgress) armCase('startup');
    const sample = () => {
      if (settled || !child.pid || measured.exceeded) return;
      try {
        const size = memory.read(child.pid);
        if (Number.isSafeInteger(size) && size > 0) {
          measured.samples++;
          measured.enforcement = 'sampled';
          measured.maximumSampledRssBytes = Math.max(measured.maximumSampledRssBytes,size);
          if (size > memory.limitBytes) { measured.exceeded = true; kill(); }
        }
      } catch (problem) {
        // A fast child may exit before /proc or ps observes it. Preserve that
        // uncertainty instead of calling zero bytes a successful measurement.
        measured.samplingError = describe(problem);
      }
    };
    if (memory !== null) child.once('spawn',() => { sample(); monitor = setInterval(sample,memory.intervalMs); });
    const timer = setTimeout(() => { timedOut = true; timeoutPhase = caseProgress ? 'batch' : 'invocation'; kill(); },timeout);
    const collect = (chunks,chunk) => {
      const left = maxBuffer - bytes;
      if (left > 0) chunks.push(chunk.subarray(0,left));
      bytes += chunk.length;
      if (bytes > maxBuffer && !overflow) { overflow = true; kill(); }
    };
    child.stdout.on('data',chunk => collect(out,chunk));
    child.stderr.on('data',chunk => { collect(err,chunk); if (caseProgress) progressChunk(chunk); });
    child.on('error',problem => { error = describe(problem); });
    child.on('close',(status,signal) => {
      settled = true; clearTimeout(timer); clearTimeout(caseTimer); clearInterval(monitor);
      if (caseProgress) {
        try { progressBuffer += progressDecoder.decode(); } catch (problem) { error ||= describe(problem); }
        if (progressBuffer !== '') caseProgress.error ||= 'Unterminated construction stderr line';
        caseProgress.complete = !caseProgress.error && !timedOut && caseProgress.active === null && caseProgress.completed === caseIds.length && caseProgress.started === caseIds.length;
      }
      const stdoutBytes = Buffer.concat(out), stderrBytes = Buffer.concat(err);
      let stdout, stderr;
      try { stdout = strictDecode(stdoutBytes); stderr = strictDecode(stderrBytes); }
      catch (problem) {
        error ||= describe(problem);
        stdout = stdoutBytes.toString('utf8'); stderr = stderrBytes.toString('utf8');
        if (onInvalidOutput) onInvalidOutput(stdoutBytes,stderrBytes);
      }
      resolveResult({command,args,status,signal,error,stdout,stderr,timedOut,timeoutPhase,overflow,killError,memory:measured,caseProgress,elapsedMs:performance.now()-started});
    });
  });
}
