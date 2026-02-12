import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* ═══════════════════════════════════════════
   AUDIO ENGINE - Realistic Diesel Bus + Music
   ═══════════════════════════════════════════ */
function createAudio(){
  var ctx=null;
  var n={};
  var started=false;
  var muted=false;

  function init(){
    if(ctx) return;
    try{ ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){return;}

    var master=ctx.createGain();
    master.gain.value=0.6;
    master.connect(ctx.destination);
    n.master=master;

    /* ═══ DIESEL ENGINE ═══
       A real diesel bus engine has:
       - Low frequency combustion pulses (~18-35 Hz base)
       - Multiple harmonics that create the characteristic "chug"
       - Exhaust resonance (filtered noise)
       - Turbo whine at higher RPMs
       - Mechanical rattle/valve noise
    */

    /* -- Combustion pulse: fundamental firing freq -- */
    var combOsc=ctx.createOscillator();
    combOsc.type="sawtooth";
    combOsc.frequency.value=18; /* idle RPM pulse */
    var combWS=ctx.createWaveShaper();
    /* soft clip to create pulsing diesel character */
    var wsLen=4096,wsCurve=new Float32Array(wsLen);
    for(var i=0;i<wsLen;i++){
      var x=i*2/wsLen-1;
      wsCurve[i]=Math.tanh(x*3)*0.8+Math.sin(x*Math.PI*2)*0.2;
    }
    combWS.curve=wsCurve;
    var combGain=ctx.createGain();
    combGain.gain.value=0.12;
    var combFilt=ctx.createBiquadFilter();
    combFilt.type="lowpass";
    combFilt.frequency.value=120;
    combFilt.Q.value=3;
    combOsc.connect(combWS);
    combWS.connect(combFilt);
    combFilt.connect(combGain);
    combGain.connect(master);
    combOsc.start();
    n.combOsc=combOsc;n.combGain=combGain;n.combFilt=combFilt;

    /* -- 2nd harmonic (diesel knock character) -- */
    var knock=ctx.createOscillator();
    knock.type="square";
    knock.frequency.value=36;
    var knockGain=ctx.createGain();
    knockGain.gain.value=0.04;
    var knockFilt=ctx.createBiquadFilter();
    knockFilt.type="bandpass";
    knockFilt.frequency.value=80;
    knockFilt.Q.value=4;
    knock.connect(knockFilt);
    knockFilt.connect(knockGain);
    knockGain.connect(master);
    knock.start();
    n.knock=knock;n.knockGain=knockGain;n.knockFilt=knockFilt;

    /* -- 3rd harmonic (adds body/growl) -- */
    var harm3=ctx.createOscillator();
    harm3.type="triangle";
    harm3.frequency.value=54;
    var harm3G=ctx.createGain();
    harm3G.gain.value=0.03;
    var harm3F=ctx.createBiquadFilter();
    harm3F.type="lowpass";
    harm3F.frequency.value=200;
    harm3F.Q.value=2;
    harm3.connect(harm3F);
    harm3F.connect(harm3G);
    harm3G.connect(master);
    harm3.start();
    n.harm3=harm3;n.harm3G=harm3G;n.harm3F=harm3F;

    /* -- Exhaust rumble (shaped noise through resonant filter) -- */
    var exhLen=ctx.sampleRate*3;
    var exhBuf=ctx.createBuffer(1,exhLen,ctx.sampleRate);
    var exhData=exhBuf.getChannelData(0);
    for(i=0;i<exhLen;i++){
      /* brownian noise for deeper rumble */
      var white=Math.random()*2-1;
      exhData[i]=i>0?(exhData[i-1]*0.98+white*0.02):white*0.02;
    }
    /* normalize */
    var exhMax=0;
    for(i=0;i<exhLen;i++)if(Math.abs(exhData[i])>exhMax)exhMax=Math.abs(exhData[i]);
    if(exhMax>0)for(i=0;i<exhLen;i++)exhData[i]/=exhMax;

    var exhSrc=ctx.createBufferSource();
    exhSrc.buffer=exhBuf;exhSrc.loop=true;
    var exhFilt1=ctx.createBiquadFilter();
    exhFilt1.type="bandpass";
    exhFilt1.frequency.value=60;
    exhFilt1.Q.value=2.5;
    var exhFilt2=ctx.createBiquadFilter();
    exhFilt2.type="peaking";
    exhFilt2.frequency.value=120;
    exhFilt2.Q.value=3;
    exhFilt2.gain.value=6;
    var exhGain=ctx.createGain();
    exhGain.gain.value=0.15;
    exhSrc.connect(exhFilt1);
    exhFilt1.connect(exhFilt2);
    exhFilt2.connect(exhGain);
    exhGain.connect(master);
    exhSrc.start();
    n.exhFilt1=exhFilt1;n.exhFilt2=exhFilt2;n.exhGain=exhGain;

    /* -- Turbo whine (sine that appears at higher RPM) -- */
    var turbo=ctx.createOscillator();
    turbo.type="sine";
    turbo.frequency.value=600;
    var turboGain=ctx.createGain();
    turboGain.gain.value=0;
    var turboFilt=ctx.createBiquadFilter();
    turboFilt.type="bandpass";
    turboFilt.frequency.value=1800;
    turboFilt.Q.value=6;
    turbo.connect(turboFilt);
    turboFilt.connect(turboGain);
    turboGain.connect(master);
    turbo.start();
    n.turbo=turbo;n.turboGain=turboGain;n.turboFilt=turboFilt;

    /* -- Mechanical rattle (high-freq filtered noise) -- */
    var ratLen=ctx.sampleRate*2;
    var ratBuf=ctx.createBuffer(1,ratLen,ctx.sampleRate);
    var ratData=ratBuf.getChannelData(0);
    for(i=0;i<ratLen;i++)ratData[i]=(Math.random()*2-1)*0.3;
    var ratSrc=ctx.createBufferSource();
    ratSrc.buffer=ratBuf;ratSrc.loop=true;
    var ratFilt=ctx.createBiquadFilter();
    ratFilt.type="bandpass";
    ratFilt.frequency.value=2500;
    ratFilt.Q.value=1.5;
    var ratGain=ctx.createGain();
    ratGain.gain.value=0.01;
    ratSrc.connect(ratFilt);
    ratFilt.connect(ratGain);
    ratGain.connect(master);
    ratSrc.start();
    n.ratGain=ratGain;n.ratFilt=ratFilt;

    /* -- Wind noise -- */
    var windLen=ctx.sampleRate*2;
    var windBuf=ctx.createBuffer(1,windLen,ctx.sampleRate);
    var windData=windBuf.getChannelData(0);
    for(i=0;i<windLen;i++)windData[i]=(Math.random()*2-1)*0.2;
    var windSrc=ctx.createBufferSource();
    windSrc.buffer=windBuf;windSrc.loop=true;
    var windGain=ctx.createGain();
    windGain.gain.value=0;
    var windFilt=ctx.createBiquadFilter();
    windFilt.type="bandpass";windFilt.frequency.value=800;windFilt.Q.value=0.4;
    windSrc.connect(windFilt);windFilt.connect(windGain);windGain.connect(master);
    windSrc.start();
    n.windGain=windGain;n.windFilt=windFilt;

    /* -- Tyre/road noise (mid-frequency noise) -- */
    var tyreLen=ctx.sampleRate*2;
    var tyreBuf=ctx.createBuffer(1,tyreLen,ctx.sampleRate);
    var tyreData=tyreBuf.getChannelData(0);
    for(i=0;i<tyreLen;i++)tyreData[i]=(Math.random()*2-1)*0.15;
    var tyreSrc=ctx.createBufferSource();
    tyreSrc.buffer=tyreBuf;tyreSrc.loop=true;
    var tyreFilt=ctx.createBiquadFilter();
    tyreFilt.type="bandpass";tyreFilt.frequency.value=400;tyreFilt.Q.value=0.6;
    var tyreGain=ctx.createGain();
    tyreGain.gain.value=0;
    tyreSrc.connect(tyreFilt);tyreFilt.connect(tyreGain);tyreGain.connect(master);
    tyreSrc.start();
    n.tyreGain=tyreGain;n.tyreFilt=tyreFilt;

    /* ═══ MUSIC ENGINE - Lo-fi Chill Step Sequencer ═══ */
    var BPM=75;
    var stepDur=60/BPM/4; /* 16th note duration */
    var barDur=stepDur*16;
    var musicBus=ctx.createGain();
    musicBus.gain.value=0.45;
    /* lo-fi warmth filter */
    var lofi=ctx.createBiquadFilter();
    lofi.type="lowpass";lofi.frequency.value=3500;lofi.Q.value=0.7;
    /* slight saturation via waveshaper */
    var warmth=ctx.createWaveShaper();
    var wLen2=2048,wCurve2=new Float32Array(wLen2);
    for(i=0;i<wLen2;i++){var x2=i*2/wLen2-1;wCurve2[i]=Math.tanh(x2*1.2);}
    warmth.curve=wCurve2;
    musicBus.connect(warmth);warmth.connect(lofi);lofi.connect(master);
    n.musicBus=musicBus;

    /* vinyl crackle */
    var crackleLen=ctx.sampleRate*4;
    var crackleBuf=ctx.createBuffer(1,crackleLen,ctx.sampleRate);
    var crackleData=crackleBuf.getChannelData(0);
    for(i=0;i<crackleLen;i++){
      crackleData[i]=Math.random()>0.997?(Math.random()*2-1)*0.4:
                     Math.random()>0.99?(Math.random()*2-1)*0.08:0;
    }
    var crackleSrc=ctx.createBufferSource();
    crackleSrc.buffer=crackleBuf;crackleSrc.loop=true;
    var crackleG=ctx.createGain();crackleG.gain.value=0.06;
    var crackleF=ctx.createBiquadFilter();crackleF.type="highpass";crackleF.frequency.value=1000;
    crackleSrc.connect(crackleF);crackleF.connect(crackleG);crackleG.connect(musicBus);
    crackleSrc.start();

    /* ── note frequency helper ── */
    function noteHz(note,oct){
      var semis={C:0,Cs:1,D:2,Ds:3,E:4,F:5,Fs:6,G:7,Gs:8,A:9,As:10,B:11};
      return 440*Math.pow(2,(semis[note]+(oct-4)*12-9)/12);
    }

    /* ── DRUM PATTERNS (16 steps per bar, 4 bars loop) ── */
    /* K=kick, S=snare, H=closed hat, O=open hat */
    var drumPats=[
      /* bar 0 */ "K--H--SH-K-H--SH",
      /* bar 1 */ "K--H--SH-K-H-OSH",
      /* bar 2 */ "K--H--SH-K-H--SH",
      /* bar 3 */ "K-KH--SH-K-HKOSH",
    ];

    /* ── CHORD PROGRESSION (each bar) ── */
    var chordProg=[
      {root:"C",notes:[noteHz("C",4),noteHz("E",4),noteHz("G",4),noteHz("B",4)]},    /* Cmaj7 */
      {root:"A",notes:[noteHz("A",3),noteHz("C",4),noteHz("E",4),noteHz("G",4)]},    /* Am7 */
      {root:"D",notes:[noteHz("D",4),noteHz("F",4),noteHz("A",4),noteHz("C",5)]},    /* Dm7 */
      {root:"G",notes:[noteHz("G",3),noteHz("B",3),noteHz("D",4),noteHz("F",4)]},    /* G7 */
    ];

    /* ── BASS PATTERN (per chord, 16 steps) ── */
    /* 0=rest, 1=root, 3=3rd, 5=5th, 8=octave up */
    var bassPats=[
      [1,0,0,0,5,0,0,3,0,1,0,0,8,0,5,0],
      [1,0,0,5,0,0,3,0,1,0,0,0,5,0,0,3],
      [1,0,0,0,3,0,5,0,0,1,0,0,5,0,3,0],
      [1,0,5,0,0,3,0,0,1,0,0,5,0,0,8,0],
    ];
    var bassRoots=[noteHz("C",2),noteHz("A",1),noteHz("D",2),noteHz("G",1)];
    var bassIntervals={1:1, 3:1.1892, 5:1.4983, 8:2}; /* rough intervals */

    /* ── MELODY (16 steps per bar, 0=rest, Hz value = play) ── */
    var melPats=[
      [0,0,noteHz("E",5),0, noteHz("G",5),0,0,noteHz("B",5), 0,noteHz("A",5),0,0, noteHz("G",5),0,noteHz("E",5),0],
      [0,0,noteHz("C",5),0, 0,noteHz("E",5),0,0, noteHz("A",5),0,noteHz("G",5),0, 0,0,noteHz("E",5),0],
      [0,noteHz("D",5),0,0, noteHz("F",5),0,noteHz("A",5),0, 0,0,noteHz("C",6),0, noteHz("A",5),0,0,0],
      [0,0,noteHz("B",4),0, noteHz("D",5),0,0,noteHz("F",5), 0,noteHz("D",5),0,0, noteHz("B",4),0,0,0],
    ];

    n.seq={
      BPM:BPM,stepDur:stepDur,barDur:barDur,
      drumPats:drumPats,chordProg:chordProg,
      bassPats:bassPats,bassRoots:bassRoots,bassIntervals:bassIntervals,
      melPats:melPats,
      currentBar:-1, nextBarTime:0, playing:false
    };

    /* ── instrument synth functions ── */
    n.playKick=function(time){
      var o=ctx.createOscillator();o.type="sine";
      o.frequency.setValueAtTime(150,time);
      o.frequency.exponentialRampToValueAtTime(30,time+0.12);
      var g=ctx.createGain();
      g.gain.setValueAtTime(0.55,time);
      g.gain.exponentialRampToValueAtTime(0.001,time+0.35);
      /* click transient */
      var click=ctx.createOscillator();click.type="square";
      click.frequency.setValueAtTime(800,time);
      var cg=ctx.createGain();
      cg.gain.setValueAtTime(0.15,time);
      cg.gain.exponentialRampToValueAtTime(0.001,time+0.015);
      o.connect(g);g.connect(musicBus);
      click.connect(cg);cg.connect(musicBus);
      o.start(time);o.stop(time+0.4);
      click.start(time);click.stop(time+0.02);
    };

    n.playSnare=function(time){
      /* body */
      var o=ctx.createOscillator();o.type="triangle";
      o.frequency.setValueAtTime(200,time);
      o.frequency.exponentialRampToValueAtTime(120,time+0.06);
      var og=ctx.createGain();
      og.gain.setValueAtTime(0.25,time);
      og.gain.exponentialRampToValueAtTime(0.001,time+0.12);
      o.connect(og);og.connect(musicBus);
      o.start(time);o.stop(time+0.15);
      /* noise */
      var nLen=Math.floor(ctx.sampleRate*0.2);
      var nBuf=ctx.createBuffer(1,nLen,ctx.sampleRate);
      var nD=nBuf.getChannelData(0);
      for(var j=0;j<nLen;j++)nD[j]=(Math.random()*2-1);
      var ns=ctx.createBufferSource();ns.buffer=nBuf;
      var ng=ctx.createGain();
      ng.gain.setValueAtTime(0.22,time);
      ng.gain.exponentialRampToValueAtTime(0.001,time+0.18);
      var nf=ctx.createBiquadFilter();nf.type="highpass";nf.frequency.value=1200;
      ns.connect(nf);nf.connect(ng);ng.connect(musicBus);
      ns.start(time);ns.stop(time+0.2);
    };

    n.playHihat=function(time,open){
      var nLen=Math.floor(ctx.sampleRate*(open?0.3:0.08));
      var nBuf=ctx.createBuffer(1,nLen,ctx.sampleRate);
      var nD=nBuf.getChannelData(0);
      for(var j=0;j<nLen;j++)nD[j]=(Math.random()*2-1);
      var ns=ctx.createBufferSource();ns.buffer=nBuf;
      var ng=ctx.createGain();
      ng.gain.setValueAtTime(open?0.1:0.08,time);
      ng.gain.exponentialRampToValueAtTime(0.001,time+(open?0.28:0.06));
      var nf=ctx.createBiquadFilter();nf.type="highpass";nf.frequency.value=6000;
      var nf2=ctx.createBiquadFilter();nf2.type="bandpass";nf2.frequency.value=10000;nf2.Q.value=1;
      ns.connect(nf);nf.connect(nf2);nf2.connect(ng);ng.connect(musicBus);
      ns.start(time);ns.stop(time+(open?0.35:0.1));
    };

    n.playBass=function(time,freq){
      var o=ctx.createOscillator();o.type="sawtooth";
      o.frequency.setValueAtTime(freq,time);
      var g=ctx.createGain();
      g.gain.setValueAtTime(0.28,time);
      g.gain.setValueAtTime(0.28,time+stepDur*0.7);
      g.gain.exponentialRampToValueAtTime(0.001,time+stepDur*0.95);
      var f=ctx.createBiquadFilter();f.type="lowpass";f.frequency.value=250;f.Q.value=3;
      o.connect(f);f.connect(g);g.connect(musicBus);
      o.start(time);o.stop(time+stepDur);
    };

    n.playPad=function(time,freqs,dur){
      for(var j=0;j<freqs.length;j++){
        var o=ctx.createOscillator();o.type=j%2===0?"triangle":"sine";
        o.frequency.setValueAtTime(freqs[j],time);
        /* slight detune for richness */
        o.detune.setValueAtTime((Math.random()-0.5)*12,time);
        var g=ctx.createGain();
        g.gain.setValueAtTime(0.001,time);
        g.gain.linearRampToValueAtTime(0.08,time+0.3);
        g.gain.setValueAtTime(0.08,time+dur-0.4);
        g.gain.linearRampToValueAtTime(0.001,time+dur);
        var pf=ctx.createBiquadFilter();pf.type="lowpass";
        pf.frequency.setValueAtTime(800,time);
        pf.frequency.linearRampToValueAtTime(1800,time+dur*0.5);
        pf.frequency.linearRampToValueAtTime(600,time+dur);
        pf.Q.value=1;
        o.connect(pf);pf.connect(g);g.connect(musicBus);
        o.start(time);o.stop(time+dur+0.1);
      }
    };

    n.playMelody=function(time,freq){
      var o=ctx.createOscillator();o.type="sine";
      o.frequency.setValueAtTime(freq,time);
      var o2=ctx.createOscillator();o2.type="triangle";
      o2.frequency.setValueAtTime(freq,time);
      o2.detune.setValueAtTime(7,time);
      var g=ctx.createGain();
      g.gain.setValueAtTime(0.001,time);
      g.gain.linearRampToValueAtTime(0.09,time+0.03);
      g.gain.exponentialRampToValueAtTime(0.001,time+stepDur*2);
      var g2=ctx.createGain();
      g2.gain.setValueAtTime(0.001,time);
      g2.gain.linearRampToValueAtTime(0.04,time+0.04);
      g2.gain.exponentialRampToValueAtTime(0.001,time+stepDur*2.5);
      var mf=ctx.createBiquadFilter();mf.type="lowpass";mf.frequency.value=2500;mf.Q.value=0.5;
      o.connect(g);o2.connect(g2);g.connect(mf);g2.connect(mf);mf.connect(musicBus);
      o.start(time);o.stop(time+stepDur*3);
      o2.start(time);o2.stop(time+stepDur*3);
    };

    n.scheduleBar=function(barIdx,startTime){
      var bi=barIdx%4;
      var dp=drumPats[bi];
      var bp=bassPats[bi];
      var mp=melPats[bi];
      var ch=chordProg[bi];
      var bRoot=bassRoots[bi];

      /* schedule pad chord for the whole bar */
      n.playPad(startTime,ch.notes,barDur);

      for(var s=0;s<16;s++){
        var t=startTime+s*stepDur;
        /* drums */
        var dc=dp[s];
        if(dc==="K")n.playKick(t);
        else if(dc==="S")n.playSnare(t);
        else if(dc==="H")n.playHihat(t,false);
        else if(dc==="O")n.playHihat(t,true);
        /* bass */
        if(bp[s]>0){
          var bFreq=bRoot*(bassIntervals[bp[s]]||1);
          n.playBass(t,bFreq);
        }
        /* melody */
        if(mp[s]>0) n.playMelody(t,mp[s]);
      }
    };

    started=true;
  }

  function updateEngine(speed,maxSpeed){
    if(!started||muted)return;
    var t=Math.abs(speed)/maxSpeed; /* 0-1 throttle */
    var now=ctx.currentTime;

    /* RPM simulation: idle ~18Hz, max ~55Hz firing frequency */
    var rpm=18+t*37;

    /* combustion fundamental */
    n.combOsc.frequency.setTargetAtTime(rpm,now,0.08);
    n.combGain.gain.setTargetAtTime(0.08+t*0.14,now,0.05);
    n.combFilt.frequency.setTargetAtTime(80+t*250,now,0.06);

    /* 2nd harmonic knock */
    n.knock.frequency.setTargetAtTime(rpm*2,now,0.08);
    n.knockGain.gain.setTargetAtTime(0.03+t*0.05,now,0.05);
    n.knockFilt.frequency.setTargetAtTime(60+t*180,now,0.06);

    /* 3rd harmonic growl */
    n.harm3.frequency.setTargetAtTime(rpm*3,now,0.08);
    n.harm3G.gain.setTargetAtTime(0.02+t*0.04,now,0.05);
    n.harm3F.frequency.setTargetAtTime(120+t*400,now,0.06);

    /* exhaust rumble gets louder and shifts up with RPM */
    n.exhGain.gain.setTargetAtTime(0.1+t*0.2,now,0.08);
    n.exhFilt1.frequency.setTargetAtTime(40+t*100,now,0.1);
    n.exhFilt2.frequency.setTargetAtTime(80+t*200,now,0.1);

    /* turbo whine - only above ~40% throttle */
    var turboT=Math.max(t-0.35,0)/0.65;
    n.turbo.frequency.setTargetAtTime(600+turboT*2400,now,0.15);
    n.turboGain.gain.setTargetAtTime(turboT*turboT*0.025,now,0.1);
    n.turboFilt.frequency.setTargetAtTime(1200+turboT*3000,now,0.12);

    /* mechanical rattle increases with RPM */
    n.ratGain.gain.setTargetAtTime(0.008+t*0.02,now,0.05);
    n.ratFilt.frequency.setTargetAtTime(1800+t*2000,now,0.08);

    /* wind noise scales with speed squared */
    n.windGain.gain.setTargetAtTime(t*t*0.1,now,0.1);
    n.windFilt.frequency.setTargetAtTime(400+t*2500,now,0.1);

    /* tyre noise */
    n.tyreGain.gain.setTargetAtTime(t*0.04,now,0.08);
    n.tyreFilt.frequency.setTargetAtTime(200+t*600,now,0.1);
  }

  function updateMusic(dt){
    if(!started||muted||!n.seq)return;
    var seq=n.seq;
    var now=ctx.currentTime;
    /* schedule-ahead approach: always keep next bar queued */
    if(!seq.playing){
      seq.playing=true;
      seq.nextBarTime=now+0.1;
      seq.currentBar=0;
      n.scheduleBar(0,seq.nextBarTime);
    }
    /* if we're close to the next bar, schedule it */
    if(now>seq.nextBarTime-0.5){
      seq.currentBar++;
      seq.nextBarTime+=seq.barDur;
      n.scheduleBar(seq.currentBar,seq.nextBarTime);
    }
  }

  function playCrash(intensity){
    if(!started||muted)return;
    var now=ctx.currentTime;
    /* impact thud - low freq burst */
    var thud=ctx.createOscillator();
    thud.type="sine";
    thud.frequency.value=60;
    thud.frequency.exponentialRampToValueAtTime(25,now+0.3);
    var thudG=ctx.createGain();
    thudG.gain.value=0.3*intensity;
    thudG.gain.exponentialRampToValueAtTime(0.001,now+0.4);
    thud.connect(thudG);thudG.connect(n.master);
    thud.start(now);thud.stop(now+0.4);

    /* crunch noise */
    var dur=0.25+intensity*0.35;
    var buf=ctx.createBuffer(1,Math.floor(ctx.sampleRate*dur),ctx.sampleRate);
    var data=buf.getChannelData(0);
    for(var i=0;i<data.length;i++){
      var env=Math.pow(1-i/data.length,2);
      data[i]=(Math.random()*2-1)*env;
    }
    var src=ctx.createBufferSource();src.buffer=buf;
    var cg=ctx.createGain();cg.gain.value=0.2+intensity*0.3;
    var cf=ctx.createBiquadFilter();cf.type="bandpass";cf.frequency.value=400+intensity*300;cf.Q.value=1;
    src.connect(cf);cf.connect(cg);cg.connect(n.master);src.start();

    /* metallic clang */
    var clang=ctx.createOscillator();
    clang.type="square";
    clang.frequency.value=120+Math.random()*80;
    var clG=ctx.createGain();
    clG.gain.value=0.1+intensity*0.1;
    clG.gain.exponentialRampToValueAtTime(0.001,now+0.2);
    clang.connect(clG);clG.connect(n.master);
    clang.start(now);clang.stop(now+0.2);

    /* glass tinkle */
    var glass=ctx.createOscillator();
    glass.type="sine";
    glass.frequency.value=3000+Math.random()*2000;
    var glG=ctx.createGain();
    glG.gain.value=0.04*intensity;
    glG.gain.exponentialRampToValueAtTime(0.001,now+0.35);
    glass.connect(glG);glG.connect(n.master);
    glass.start(now);glass.stop(now+0.35);
  }

  function playDoor(){
    if(!started||muted)return;
    var now=ctx.currentTime;
    /* pneumatic hiss */
    var dur=0.6;
    var buf=ctx.createBuffer(1,Math.floor(ctx.sampleRate*dur),ctx.sampleRate);
    var data=buf.getChannelData(0);
    for(var i=0;i<data.length;i++){
      var t2=i/data.length;
      var env=t2<0.08?t2/0.08:Math.pow(1-((t2-0.08)/0.92),1.5);
      data[i]=(Math.random()*2-1)*env*0.6;
    }
    var src=ctx.createBufferSource();src.buffer=buf;
    var g=ctx.createGain();g.gain.value=0.12;
    var f=ctx.createBiquadFilter();f.type="highpass";f.frequency.value=1500;
    src.connect(f);f.connect(g);g.connect(n.master);src.start();

    /* mechanical thunk */
    var thk=ctx.createOscillator();
    thk.type="sine";
    thk.frequency.value=180;
    thk.frequency.exponentialRampToValueAtTime(60,now+0.1);
    var thkG=ctx.createGain();
    thkG.gain.value=0.1;
    thkG.gain.exponentialRampToValueAtTime(0.001,now+0.15);
    thk.connect(thkG);thkG.connect(n.master);
    thk.start(now);thk.stop(now+0.16);

    /* slide rail sound */
    var rail=ctx.createOscillator();
    rail.type="sawtooth";
    rail.frequency.value=400;
    rail.frequency.linearRampToValueAtTime(200,now+0.3);
    var rlG=ctx.createGain();
    rlG.gain.value=0.02;
    rlG.gain.exponentialRampToValueAtTime(0.001,now+0.35);
    var rlF=ctx.createBiquadFilter();rlF.type="bandpass";rlF.frequency.value=800;rlF.Q.value=2;
    rail.connect(rlF);rlF.connect(rlG);rlG.connect(n.master);
    rail.start(now);rail.stop(now+0.36);
  }

  function playBell(){
    if(!started||muted)return;
    var now=ctx.currentTime;
    /* two-tone bus bell */
    var freqs=[880,1046.50];
    for(var bi=0;bi<2;bi++){
      var osc=ctx.createOscillator();
      osc.type="sine";
      osc.frequency.value=freqs[bi];
      var g=ctx.createGain();
      g.gain.value=bi===0?0.1:0.06;
      g.gain.exponentialRampToValueAtTime(0.001,now+0.7);
      osc.connect(g);g.connect(n.master);
      osc.start(now+bi*0.15);osc.stop(now+bi*0.15+0.7);
    }
  }

  function setMute(m){muted=m;if(n.master)n.master.gain.value=m?0:0.6;}
  function getMuted(){return muted;}
  function playHorn(){
    if(!started||muted)return;
    var now=ctx.currentTime;
    /* two-tone bus horn */
    var h1=ctx.createOscillator();h1.type="sawtooth";h1.frequency.value=310;
    var h2=ctx.createOscillator();h2.type="sawtooth";h2.frequency.value=392;
    var hg=ctx.createGain();hg.gain.setValueAtTime(0.001,now);
    hg.gain.linearRampToValueAtTime(0.12,now+0.05);
    hg.gain.setValueAtTime(0.12,now+0.4);
    hg.gain.linearRampToValueAtTime(0.001,now+0.55);
    var hf=ctx.createBiquadFilter();hf.type="lowpass";hf.frequency.value=1200;hf.Q.value=1;
    h1.connect(hf);h2.connect(hf);hf.connect(hg);hg.connect(n.master);
    h1.start(now);h1.stop(now+0.55);h2.start(now);h2.stop(now+0.55);
  }
  function dispose(){if(ctx){ctx.close();ctx=null;started=false;}}

  return{init:init,updateEngine:updateEngine,updateMusic:updateMusic,
    playCrash:playCrash,playDoor:playDoor,playBell:playBell,playHorn:playHorn,
    setMute:setMute,getMuted:getMuted,dispose:dispose};
}

/* ═══════════════════════════════════════
   GAME DATA
   ═══════════════════════════════════════ */
var R=[
  [0,80],[0,40],[0,0],[0,-40],[0,-80],
  [40,-120],[80,-120],[120,-120],[160,-120],
  [200,-80],[200,-40],[200,0],[200,40],[200,80],
  [160,120],[120,120],[80,120],[40,80],
  [40,40],[80,0],[120,-20],[160,-20],
  [160,20],[120,60],[80,60]
];
var STOPS=[
  {i:0,n:"Elm St Depot"},{i:4,n:"Hillcrest Ave"},
  {i:8,n:"Central Station"},{i:11,n:"Greenfield Park"},
  {i:14,n:"Market Square"},{i:18,n:"River Bridge"},
  {i:21,n:"Sunset Blvd"},{i:24,n:"Terminal"}
];
function dd(ax,az,bx,bz){return Math.sqrt((ax-bx)*(ax-bx)+(az-bz)*(az-bz));}
/* distance from point to line segment */
function ptSegDist(px,pz,ax,az,bx,bz){
  var dx=bx-ax,dz=bz-az,len2=dx*dx+dz*dz;
  if(len2<0.01)return dd(px,pz,ax,az);
  var t=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/len2));
  return dd(px,pz,ax+t*dx,az+t*dz);
}
/* check if point is too close to any road segment */
function nearRoad(px,pz,minDist){
  for(var ri=0;ri<R.length-1;ri++){
    if(ptSegDist(px,pz,R[ri][0],R[ri][1],R[ri+1][0],R[ri+1][1])<minDist)return true;
  }
  return false;
}
/* smooth road curve from waypoints via Catmull-Rom spline */
function generateSmoothRoad(waypoints){
  var pts=[];
  for(var i2=0;i2<waypoints.length;i2++)pts.push(new THREE.Vector3(waypoints[i2][0],0,waypoints[i2][1]));
  var curve=new THREE.CatmullRomCurve3(pts,false,'centripetal');
  var sampled=curve.getPoints((waypoints.length-1)*12);
  var result=[];
  for(var j2=0;j2<sampled.length;j2++)result.push([sampled[j2].x,sampled[j2].z]);
  return result;
}
var smoothR=generateSmoothRoad(R);
function newPax(){
  var p=[];
  for(var i=0;i<STOPS.length-1;i++){var c=1+Math.floor(Math.random()*3);
    for(var j=0;j<c;j++){var d2=i+1+Math.floor(Math.random()*(STOPS.length-i-1));
      p.push({origin:i,dest:Math.min(d2,STOPS.length-1),on:false,done:false});}}
  return p;
}

/* ═══════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════ */
export default function App(){
  var canvasRef=useRef(null);
  var stateRef=useRef("menu");
  var audioRef=useRef(null);
  var [ui,setUi]=useState({phase:"menu",spd:0,score:0,onBus:0,del:0,tot:0,
    near:null,stopN:"",nextS:STOPS[0].n,prog:0,time:0,bOn:0,bOff:0,crashed:false,damage:0,mathPrev:0,mathSolved:true});
  var keysRef=useRef({});
  var gRef=useRef(null);
  var [muted,setMuted]=useState(false);
  var [mathInput,setMathInput]=useState("");
  var [mathWrong,setMathWrong]=useState(false);

  /* init audio on first interaction */
  function ensureAudio(){
    if(!audioRef.current) audioRef.current=createAudio();
    audioRef.current.init();
  }

  useEffect(function(){
    function dn(e){
      var k=e.key;
      if(k==="ArrowUp"||k==="ArrowDown"||k==="ArrowLeft"||k==="ArrowRight"||k===" "||k==="w"||k==="a"||k==="s"||k==="d")e.preventDefault();
      keysRef.current[k.toLowerCase()]=true;
    }
    function up(e){keysRef.current[e.key.toLowerCase()]=false;}
    window.addEventListener("keydown",dn);
    window.addEventListener("keyup",up);
    return function(){window.removeEventListener("keydown",dn);window.removeEventListener("keyup",up);};
  },[]);

  /* ═══════════════════════════════════════
     THREE.JS SCENE
     ═══════════════════════════════════════ */
  useEffect(function(){
    var el=canvasRef.current;
    if(!el)return;
    var W=el.clientWidth||900,H=el.clientHeight||650;

    /* renderer */
    var renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"});
    renderer.setSize(W,H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.05;
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    var scene=new THREE.Scene();
    /* gradient sky via vertex colors */
    scene.background=new THREE.Color(0x6ab4d6);
    scene.fog=new THREE.FogExp2(0x9dc8db,0.0018);

    var camera=new THREE.PerspectiveCamera(50,W/H,0.5,700);
    camera.position.set(0,20,100);

    /* ── LIGHTING (realistic multi-light) ── */
    var amb=new THREE.AmbientLight(0xc8dce8,0.4);
    scene.add(amb);

    var sun=new THREE.DirectionalLight(0xfff0d4,1.15);
    sun.position.set(100,160,80);
    sun.castShadow=true;
    sun.shadow.mapSize.set(1024,1024);
    sun.shadow.camera.left=-150;sun.shadow.camera.right=150;
    sun.shadow.camera.top=150;sun.shadow.camera.bottom=-150;
    sun.shadow.camera.near=10;sun.shadow.camera.far=400;
    sun.shadow.bias=-0.0005;
    sun.shadow.normalBias=0.02;
    scene.add(sun);

    /* warm fill light from opposite side */
    var fill=new THREE.DirectionalLight(0xffe8c0,0.25);
    fill.position.set(-80,60,-40);
    scene.add(fill);

    var hemi=new THREE.HemisphereLight(0x8ec4e8,0x4a7a3a,0.35);
    scene.add(hemi);

    /* ── GROUND with subtle texture ── */
    var gndGeo=new THREE.PlaneGeometry(800,800,80,80);
    /* add subtle height variation */
    var gndVerts=gndGeo.attributes.position;
    for(var vi=0;vi<gndVerts.count;vi++){
      var gx=gndVerts.getX(vi),gy=gndVerts.getY(vi);
      /* don't deform near roads - check actual segments */
      var isNearRoad=false;
      for(var ri=0;ri<R.length-1;ri++){if(ptSegDist(gx,gy,R[ri][0],R[ri][1],R[ri+1][0],R[ri+1][1])<25){isNearRoad=true;break;}}
      if(!isNearRoad) gndVerts.setZ(vi,(Math.sin(gx*0.03)*Math.cos(gy*0.03))*0.8);
    }
    gndGeo.computeVertexNormals();
    var gndMat=new THREE.MeshStandardMaterial({color:0x4a8a4a,roughness:0.95,metalness:0});
    var gnd=new THREE.Mesh(gndGeo,gndMat);
    gnd.rotation.x=-Math.PI/2;gnd.receiveShadow=true;scene.add(gnd);

    /* ── ROAD ── */
    var roadMat=new THREE.MeshStandardMaterial({color:0x3a3a3a,roughness:0.85,metalness:0.05});
    var swalkMat=new THREE.MeshStandardMaterial({color:0x8a8a8a,roughness:0.75,metalness:0.02});
    var dashMat=new THREE.MeshStandardMaterial({color:0xcccc44,roughness:0.5,emissive:0x333300,emissiveIntensity:0.1});
    var edgeMat=new THREE.MeshStandardMaterial({color:0xdddddd,roughness:0.6});
    var i,a,b,dx,dz,len,cx,cz,ang,m,s,d,t;
    var curbMat=new THREE.MeshStandardMaterial({color:0x777777,roughness:0.7});
    var roadGeos=[],swalkGeos=[],curbGeos=[],dashGeos=[],edgeGeos=[],arrowGeos=[];

    for(i=0;i<smoothR.length-1;i++){
      a=smoothR[i];b=smoothR[i+1];dx=b[0]-a[0];dz=b[1]-a[1];
      len=Math.sqrt(dx*dx+dz*dz);cx=(a[0]+b[0])/2;cz=(a[1]+b[1])/2;ang=Math.atan2(dx,dz);
      var rg=new THREE.BoxGeometry(14,0.15,len+0.5);rg.rotateY(ang);rg.translate(cx,0.07,cz);roadGeos.push(rg);
      for(s=-1;s<=1;s+=2){
        var sg=new THREE.BoxGeometry(2.5,0.28,len+0.5);sg.rotateY(ang);
        sg.translate(cx+Math.cos(ang)*s*8.5,0.14,cz-Math.sin(ang)*s*8.5);swalkGeos.push(sg);
        var kg=new THREE.BoxGeometry(0.3,0.25,len+0.5);kg.rotateY(ang);
        kg.translate(cx+Math.cos(ang)*s*7.2,0.12,cz-Math.sin(ang)*s*7.2);curbGeos.push(kg);
      }
      if(i%3===0){var dg=new THREE.BoxGeometry(0.3,0.16,2.2);dg.rotateY(ang);
        dg.translate(cx,0.16,cz);dashGeos.push(dg);}
      for(s=-1;s<=1;s+=2){
        var eg=new THREE.BoxGeometry(0.2,0.16,len+0.3);eg.rotateY(ang);
        eg.translate(cx+Math.cos(ang)*s*6,0.16,cz-Math.sin(ang)*s*6);edgeGeos.push(eg);}
    }
    for(i=0;i<R.length;i++){
      var jg=new THREE.CylinderGeometry(7,7,0.15,16);jg.translate(R[i][0],0.07,R[i][1]);roadGeos.push(jg);}

    /* route arrows */
    var arMat=new THREE.MeshStandardMaterial({color:0x00aaff,transparent:true,opacity:0.3,emissive:0x0066aa,emissiveIntensity:0.3});
    var arDist=0;
    for(i=0;i<smoothR.length-1;i++){
      a=smoothR[i];b=smoothR[i+1];dx=b[0]-a[0];dz=b[1]-a[1];
      var segL=Math.sqrt(dx*dx+dz*dz);arDist+=segL;
      if(arDist>=14){arDist-=14;
        var ag=new THREE.ConeGeometry(0.5,1.2,4);ag.rotateX(Math.PI/2);ag.rotateZ(-Math.atan2(dx,dz));
        ag.translate(b[0],0.25,b[1]);arrowGeos.push(ag);}}

    /* merge road geometries into single meshes to reduce draw calls */
    var merged;
    merged=mergeGeometries(roadGeos);if(merged){m=new THREE.Mesh(merged,roadMat);m.receiveShadow=true;scene.add(m);}
    merged=mergeGeometries(swalkGeos);if(merged){m=new THREE.Mesh(merged,swalkMat);m.receiveShadow=true;m.castShadow=true;scene.add(m);}
    merged=mergeGeometries(curbGeos);if(merged){m=new THREE.Mesh(merged,curbMat);scene.add(m);}
    merged=mergeGeometries(dashGeos);if(merged){m=new THREE.Mesh(merged,dashMat);scene.add(m);}
    merged=mergeGeometries(edgeGeos);if(merged){m=new THREE.Mesh(merged,edgeMat);scene.add(m);}
    merged=mergeGeometries(arrowGeos);if(merged){m=new THREE.Mesh(merged,arMat);scene.add(m);}

    /* ── BUILDINGS (PBR materials) ── */
    var obstacles=[];
    var bMats=[
      new THREE.MeshStandardMaterial({color:0x8b7355,roughness:0.85,metalness:0.02}),
      new THREE.MeshStandardMaterial({color:0x6b6b6b,roughness:0.7,metalness:0.1}),
      new THREE.MeshStandardMaterial({color:0x9a6040,roughness:0.82,metalness:0.03}),
      new THREE.MeshStandardMaterial({color:0x708090,roughness:0.65,metalness:0.15}),
      new THREE.MeshStandardMaterial({color:0xb08840,roughness:0.78,metalness:0.05}),
      new THREE.MeshStandardMaterial({color:0x5a6a7a,roughness:0.7,metalness:0.12}),
      new THREE.MeshStandardMaterial({color:0x7a5030,roughness:0.88,metalness:0.02}),
      new THREE.MeshStandardMaterial({color:0xc4a070,roughness:0.75,metalness:0.04}),
      new THREE.MeshStandardMaterial({color:0x556050,roughness:0.82,metalness:0.06}),
    ];
    var winMat1=new THREE.MeshStandardMaterial({color:0xeeeebb,roughness:0.2,metalness:0.3,emissive:0x887744,emissiveIntensity:0.3,transparent:true,opacity:0.75});
    var winMat2=new THREE.MeshStandardMaterial({color:0xffd866,roughness:0.15,metalness:0.2,emissive:0xffaa22,emissiveIntensity:0.6,transparent:true,opacity:0.85});
    var winDark=new THREE.MeshStandardMaterial({color:0x334455,roughness:0.3,metalness:0.4,transparent:true,opacity:0.8});
    var placed=[];

    function canPlace(bx,bz2){
      if(nearRoad(bx,bz2,24))return false;
      for(var ii2=0;ii2<placed.length;ii2++)if(dd(bx,bz2,placed[ii2][0],placed[ii2][1])<13)return false;
      return true;
    }

    for(i=0;i<R.length-1;i++){
      a=R[i];b=R[i+1];dx=b[0]-a[0];dz=b[1]-a[1];len=Math.sqrt(dx*dx+dz*dz);
      ang=Math.atan2(dx,dz);var px=Math.cos(ang),pz=-Math.sin(ang);
      var bc=Math.floor(len/18);
      for(var bi=0;bi<bc;bi++){for(s=-1;s<=1;s+=2){
        if(Math.random()>0.72)continue;
        t=(bi+0.5)/bc;var off=20+Math.random()*12;
        var bx=a[0]+dx*t+px*s*off,bz2=a[1]+dz*t+pz*s*off;
        if(!canPlace(bx,bz2))continue;
        var bw=6+Math.random()*9,bd=6+Math.random()*9,bh=8+Math.random()*25;
        m=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),bMats[Math.floor(Math.random()*bMats.length)]);
        m.position.set(bx,bh/2,bz2);m.castShadow=true;m.receiveShadow=true;scene.add(m);
        /* roof ledge */
        var ledge=new THREE.Mesh(new THREE.BoxGeometry(bw+0.6,0.3,bd+0.6),new THREE.MeshStandardMaterial({color:0x555555,roughness:0.6}));
        ledge.position.set(bx,bh+0.15,bz2);ledge.castShadow=true;scene.add(ledge);
        /* windows - more detailed */
        var wr=Math.floor(bh/5),wc2=Math.floor(bw/3.5),r,c;
        for(r=0;r<wr;r++)for(c=0;c<wc2;c++){
          var rng=Math.random();
          if(rng>0.75)continue;
          var wmat=rng<0.25?winMat2:rng<0.5?winMat1:winDark;
          for(var f=-1;f<=1;f+=2){
            var wm=new THREE.Mesh(new THREE.PlaneGeometry(1.2,1.8),wmat);
            wm.position.set(bx-bw/2+1.8+c*3.2,3+r*5,bz2+f*(bd/2+0.06));
            if(f<0)wm.rotation.y=Math.PI;scene.add(wm);
          }
        }
        placed.push([bx,bz2]);obstacles.push({x:bx,z:bz2,hw:bw/2+1.5,hd:bd/2+1.5});
      }}
    }
    for(i=0;i<45;i++){
      var bx3=-130+Math.random()*460,bz3=-190+Math.random()*400;
      if(!canPlace(bx3,bz3))continue;
      var bh3=5+Math.random()*16,bw3=5+Math.random()*7,bd3=5+Math.random()*7;
      m=new THREE.Mesh(new THREE.BoxGeometry(bw3,bh3,bd3),bMats[Math.floor(Math.random()*bMats.length)]);
      m.position.set(bx3,bh3/2,bz3);m.castShadow=true;m.receiveShadow=true;scene.add(m);
      placed.push([bx3,bz3]);obstacles.push({x:bx3,z:bz3,hw:bw3/2+1.5,hd:bd3/2+1.5});
    }

    /* ── TREES (smoother) ── */
    var trkMat=new THREE.MeshStandardMaterial({color:0x5c3317,roughness:0.9,metalness:0});
    var lfMats=[
      new THREE.MeshStandardMaterial({color:0x2a8a2a,roughness:0.85,metalness:0}),
      new THREE.MeshStandardMaterial({color:0x358a35,roughness:0.8,metalness:0}),
      new THREE.MeshStandardMaterial({color:0x1c7a1c,roughness:0.88,metalness:0}),
    ];
    for(i=0;i<70;i++){
      var tx=-90+Math.random()*380,tz2=-170+Math.random()*360;
      /* check distance to road segments (not just waypoints) */
      if(nearRoad(tx,tz2,14))continue;
      /* check against placed buildings */
      var treeOk=true;
      for(var ii3=0;ii3<placed.length;ii3++){if(dd(tx,tz2,placed[ii3][0],placed[ii3][1])<10){treeOk=false;break;}}
      if(!treeOk)continue;
      /* trunk - smoother cylinder */
      m=new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.45,4,8),trkMat);
      m.position.set(tx,2,tz2);m.castShadow=true;scene.add(m);
      /* canopy - two spheres for fullness */
      var lsz=2+Math.random()*1.8;
      var lfm=lfMats[Math.floor(Math.random()*3)];
      m=new THREE.Mesh(new THREE.SphereGeometry(lsz,10,8),lfm);
      m.position.set(tx,4.8+Math.random()*0.5,tz2);m.castShadow=true;scene.add(m);
      /* second smaller sphere offset */
      var ls2=lsz*0.7;
      m=new THREE.Mesh(new THREE.SphereGeometry(ls2,8,6),lfm);
      m.position.set(tx+Math.random()*1.2-0.6,5.5+Math.random()*0.5,tz2+Math.random()*1.2-0.6);
      m.castShadow=true;scene.add(m);
      obstacles.push({x:tx,z:tz2,r:2.0});
    }

    /* ── STREET LIGHTS along route ── */
    var poleMat=new THREE.MeshStandardMaterial({color:0x555555,roughness:0.4,metalness:0.6});
    var lightBulbMat=new THREE.MeshStandardMaterial({color:0xffffcc,emissive:0xffddaa,emissiveIntensity:0.8,roughness:0.2});
    for(i=0;i<R.length-1;i+=2){
      a=R[i];b=R[i+1];dx=b[0]-a[0];dz=b[1]-a[1];len=Math.sqrt(dx*dx+dz*dz);
      ang=Math.atan2(dx,dz);
      for(s=-1;s<=1;s+=2){
        var lpx=a[0]+Math.cos(ang)*s*10;
        var lpz=a[1]-Math.sin(ang)*s*10;
        /* pole */
        m=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.12,5.5,6),poleMat);
        m.position.set(lpx,2.75,lpz);m.castShadow=true;scene.add(m);
        /* arm */
        m=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,2,4),poleMat);
        m.position.set(lpx-s*0.8,5.2,lpz);m.rotation.z=s*Math.PI/2.3;scene.add(m);
        /* light */
        m=new THREE.Mesh(new THREE.SphereGeometry(0.25,6,5),lightBulbMat);
        m.position.set(lpx-s*1.6,5,lpz);scene.add(m);
        /* small point light for glow */
        var pl=new THREE.PointLight(0xffddaa,0.15,20);
        pl.position.set(lpx-s*1.6,4.8,lpz);
        scene.add(pl);
      }
    }

    /* ── BUS STOPS ── */
    var stopRings=[];var waitFigs=[];var stopPositions=[];
    var pstMat=new THREE.MeshStandardMaterial({color:0x777777,roughness:0.4,metalness:0.5});
    var redMat=new THREE.MeshStandardMaterial({color:0xcc2222,roughness:0.5,metalness:0.1});
    var glassBlueMat=new THREE.MeshStandardMaterial({color:0x4488bb,roughness:0.15,metalness:0.3,transparent:true,opacity:0.45});
    var roofStopMat=new THREE.MeshStandardMaterial({color:0x336699,roughness:0.3,metalness:0.4,transparent:true,opacity:0.55});
    var benchMat=new THREE.MeshStandardMaterial({color:0x6b4226,roughness:0.85,metalness:0});
    var bodyFig=new THREE.MeshStandardMaterial({color:0x334499,roughness:0.8});
    var headFig=new THREE.MeshStandardMaterial({color:0xd4a574,roughness:0.7});

    for(var si=0;si<STOPS.length;si++){
      var stop=STOPS[si],wp=R[stop.i];
      var nx=0,nz2=0;
      if(stop.i<R.length-1){var nxt=R[stop.i+1],ddx=nxt[0]-wp[0],ddz=nxt[1]-wp[1],ll=Math.sqrt(ddx*ddx+ddz*ddz);
        if(ll>0.01){nx=-ddz/ll;nz2=ddx/ll;}}
      var sx=wp[0]+nx*12,sz=wp[1]+nz2*12;
      stopPositions.push({sx:sx,sz:sz,nx:nx,nz:nz2});
      /* shelter */
      for(var ox=-1.5;ox<=1.5;ox+=3){m=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.1,3.2,8),pstMat);m.position.set(sx+ox,1.6,sz);m.castShadow=true;scene.add(m);}
      m=new THREE.Mesh(new THREE.BoxGeometry(4,0.15,2.3),roofStopMat);m.position.set(sx,3.22,sz);m.castShadow=true;scene.add(m);
      m=new THREE.Mesh(new THREE.BoxGeometry(4,3,0.08),glassBlueMat);m.position.set(sx,1.7,sz-1.1);scene.add(m);
      /* sign */
      m=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,3.8,6),pstMat);m.position.set(sx+2.3,1.9,sz+0.8);scene.add(m);
      m=new THREE.Mesh(new THREE.BoxGeometry(1,1,0.1),redMat);m.position.set(sx+2.3,3.6,sz+0.8);scene.add(m);
      obstacles.push({x:sx,z:sz,hw:3,hd:2.5});
      /* bench */
      m=new THREE.Mesh(new THREE.BoxGeometry(2.8,0.15,0.7),benchMat);m.position.set(sx,0.7,sz-0.4);m.castShadow=true;scene.add(m);
      /* bench legs */
      for(var bl=-1;bl<=1;bl+=2){m=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.6,0.1),pstMat);m.position.set(sx+bl*1.1,0.35,sz-0.4);scene.add(m);}

      /* ground ring glow */
      var ringMat=new THREE.MeshStandardMaterial({color:0x00ff88,emissive:0x00ff66,emissiveIntensity:0.5,transparent:true,opacity:0.35});
      var outerDisc=new THREE.Mesh(new THREE.CylinderGeometry(7,7,0.08,28),ringMat);
      outerDisc.position.set(wp[0],0.12,wp[1]);scene.add(outerDisc);
      var innerDisc=new THREE.Mesh(new THREE.CylinderGeometry(5.5,5.5,0.1,28),gndMat);
      innerDisc.position.set(wp[0],0.13,wp[1]);scene.add(innerDisc);
      stopRings.push(outerDisc);

      /* waiting figures */
      var figs=[];
      for(var fi=0;fi<4;fi++){
        var fg=new THREE.Group();
        /* body */
        var fb=new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.28,1.1,8),bodyFig);fb.position.set(0,0.85,0);fg.add(fb);
        /* head */
        var fh=new THREE.Mesh(new THREE.SphereGeometry(0.22,8,6),headFig);fh.position.set(0,1.65,0);fg.add(fh);
        fg.position.set(sx-1.2+fi*0.85,0,sz+0.5);fg.visible=false;
        fg.userData={walkState:"idle",walkProgress:0,walkStartX:0,walkStartZ:0,walkEndX:0,walkEndZ:0,walkSpeed:5,paxIndex:-1,homeX:sx-1.2+fi*0.85,homeZ:sz+0.5};
        scene.add(fg);figs.push(fg);
      }
      waitFigs.push(figs);
    }

    /* alighting figure pool */
    var alightFigs=[],alightFigPool=[];
    function createAlightFig(){
      if(alightFigPool.length>0){var fig=alightFigPool.pop();fig.visible=true;return fig;}
      var fg2=new THREE.Group();
      var fb2=new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.28,1.1,8),bodyFig);fb2.position.set(0,0.85,0);fg2.add(fb2);
      var fh2=new THREE.Mesh(new THREE.SphereGeometry(0.22,8,6),headFig);fh2.position.set(0,1.65,0);fg2.add(fh2);
      fg2.userData={walkState:"alighting",walkProgress:0,walkStartX:0,walkStartZ:0,walkEndX:0,walkEndZ:0,walkSpeed:5,paxIndex:-1};
      scene.add(fg2);return fg2;
    }
    function recycleAlightFig(fig){
      fig.visible=false;fig.userData.walkState="idle";fig.userData.walkProgress=0;
      var idx=alightFigs.indexOf(fig);if(idx>=0)alightFigs.splice(idx,1);alightFigPool.push(fig);
    }

    /* ── MOUNTAINS (smoother) ── */
    var mtMat=new THREE.MeshStandardMaterial({color:0x667788,roughness:0.9,metalness:0,transparent:true,opacity:0.45});
    var snowMat=new THREE.MeshStandardMaterial({color:0xeeeeff,roughness:0.8,metalness:0,transparent:true,opacity:0.5});
    for(i=0;i<14;i++){
      var aa=i/14*Math.PI*2,rr=320+Math.random()*60,hh=30+Math.random()*50;
      m=new THREE.Mesh(new THREE.ConeGeometry(32+Math.random()*22,hh,6),mtMat);
      m.position.set(Math.cos(aa)*rr+100,hh/2-4,Math.sin(aa)*rr);scene.add(m);
      /* snow cap */
      if(hh>45){
        var cap=new THREE.Mesh(new THREE.ConeGeometry(10,hh*0.2,6),snowMat);
        cap.position.set(Math.cos(aa)*rr+100,hh*0.9,Math.sin(aa)*rr);scene.add(cap);
      }
    }

    /* ── CLOUDS (volumetric-ish) ── */
    var cldMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0,transparent:true,opacity:0.55});
    var clouds=[];
    for(i=0;i<8;i++){
      var cg=new THREE.Group();
      var numPuffs=2+Math.floor(Math.random()*2);
      for(var j=0;j<numPuffs;j++){
        var puffSize=4+Math.random()*7;
        var cs=new THREE.Mesh(new THREE.SphereGeometry(puffSize,8,6),cldMat);
        cs.position.set(j*puffSize*0.8-numPuffs*2,Math.random()*2,Math.random()*3);
        cs.scale.y=0.4+Math.random()*0.2;cs.scale.x=0.8+Math.random()*0.4;
        cg.add(cs);
      }
      cg.position.set(-250+Math.random()*700,52+Math.random()*45,-250+Math.random()*500);
      scene.add(cg);clouds.push(cg);
    }


    /* ═══════════════════════════════════════
       BUS (enhanced detail)
       ═══════════════════════════════════════ */
    var bus=new THREE.Group();
    var busBodyMat=new THREE.MeshStandardMaterial({color:0xe8b400,roughness:0.35,metalness:0.15});
    var busTrimMat=new THREE.MeshStandardMaterial({color:0xcccccc,roughness:0.3,metalness:0.5});
    var busDarkMat=new THREE.MeshStandardMaterial({color:0x2a2a2a,roughness:0.6,metalness:0.2});
    var busGlassMat=new THREE.MeshStandardMaterial({color:0x8abbdd,roughness:0.1,metalness:0.4,transparent:true,opacity:0.4});

    /* body */
    m=new THREE.Mesh(new THREE.BoxGeometry(3.2,2.8,7.5),busBodyMat);
    m.position.set(0,1.9,0);m.castShadow=true;bus.add(m);
    /* roof */
    m=new THREE.Mesh(new THREE.BoxGeometry(3.3,0.2,7.6),busTrimMat);
    m.position.set(0,3.35,0);m.castShadow=true;bus.add(m);
    /* ac unit */
    m=new THREE.Mesh(new THREE.BoxGeometry(1.8,0.35,2.5),new THREE.MeshStandardMaterial({color:0x888888,roughness:0.5,metalness:0.3}));
    m.position.set(0,3.65,0);bus.add(m);
    /* windshield */
    m=new THREE.Mesh(new THREE.PlaneGeometry(2.8,1.8),busGlassMat);
    m.position.set(0,2.2,-3.76);bus.add(m);
    /* rear */
    m=new THREE.Mesh(new THREE.PlaneGeometry(2.2,1.4),busGlassMat);
    m.position.set(0,2.2,3.76);m.rotation.y=Math.PI;bus.add(m);
    /* side windows */
    for(s=-1;s<=1;s+=2)for(var w=0;w<4;w++){
      m=new THREE.Mesh(new THREE.PlaneGeometry(1.3,1.3),busGlassMat);
      m.position.set(s*1.61,2.3,-2.3+w*1.7);m.rotation.y=s*Math.PI/2;bus.add(m);
    }
    /* bumpers */
    m=new THREE.Mesh(new THREE.BoxGeometry(3.4,0.4,0.2),busDarkMat);m.position.set(0,0.55,-3.82);bus.add(m);
    m=new THREE.Mesh(new THREE.BoxGeometry(3.4,0.4,0.2),busDarkMat);m.position.set(0,0.55,3.82);bus.add(m);
    /* headlights */
    var hlMat=new THREE.MeshStandardMaterial({color:0xffffee,emissive:0xffffcc,emissiveIntensity:0.8,roughness:0.1,metalness:0.3});
    for(s=-1;s<=1;s+=2){m=new THREE.Mesh(new THREE.SphereGeometry(0.2,8,6),hlMat);m.position.set(s*1.1,1.1,-3.78);bus.add(m);}
    /* tail lights */
    var tlMat=new THREE.MeshStandardMaterial({color:0xff2200,emissive:0xff1100,emissiveIntensity:0.6,roughness:0.2});
    for(s=-1;s<=1;s+=2){m=new THREE.Mesh(new THREE.BoxGeometry(0.4,0.25,0.06),tlMat);m.position.set(s*1.2,1.1,3.8);bus.add(m);}
    /* turn signals */
    var tsMat=new THREE.MeshStandardMaterial({color:0xffaa00,emissive:0xff8800,emissiveIntensity:0.4,roughness:0.2});
    for(s=-1;s<=1;s+=2){m=new THREE.Mesh(new THREE.BoxGeometry(0.25,0.15,0.06),tsMat);m.position.set(s*1.4,1.4,-3.8);bus.add(m);}
    /* wheels */
    var whMat=new THREE.MeshStandardMaterial({color:0x1a1a1a,roughness:0.75,metalness:0.1});
    var hubMat=new THREE.MeshStandardMaterial({color:0xaaaaaa,roughness:0.3,metalness:0.7});
    for(var zo=-2.2;zo<=2.2;zo+=4.4)for(s=-1;s<=1;s+=2){
      m=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.55,0.35,12),whMat);
      m.rotation.z=Math.PI/2;m.position.set(s*1.7,0.55,zo);m.castShadow=true;bus.add(m);
      m=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.18,0.38,8),hubMat);
      m.rotation.z=Math.PI/2;m.position.set(s*1.7,0.55,zo);bus.add(m);
    }
    /* red stripe */
    var strMat=new THREE.MeshStandardMaterial({color:0xcc0000,roughness:0.4,metalness:0.1});
    for(s=-1;s<=1;s+=2){m=new THREE.Mesh(new THREE.PlaneGeometry(7.55,0.25),strMat);m.position.set(s*1.62,1.4,0);m.rotation.y=s*Math.PI/2;bus.add(m);}
    /* route display */
    m=new THREE.Mesh(new THREE.PlaneGeometry(1.8,0.65),new THREE.MeshStandardMaterial({color:0xff6600,emissive:0xff4400,emissiveIntensity:0.4,roughness:0.3}));
    m.position.set(0,3.0,-3.77);bus.add(m);
    /* side mirrors */
    for(s=-1;s<=1;s+=2){
      m=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.2,0.15),busDarkMat);
      m.position.set(s*1.8,2.0,-3.0);bus.add(m);
    }

    var initAng=Math.atan2(R[1][0]-R[0][0],R[1][1]-R[0][1])+Math.PI;
    bus.position.set(R[0][0],0,R[0][1]);bus.rotation.y=initAng;
    scene.add(bus);

    /* ══ GAME STATE ══ */
    var g={
      speed:0,heading:initAng,steer:0,pax:newPax(),onBus:0,delivered:0,score:0,
      nearIdx:-1,stoppedIdx:-1,time:0,nextWp:1,visited:{},
      crashed:false,crashTimer:0,damage:0,camShake:0,
      prevX:R[0][0],prevZ:R[0][1],obstacles:obstacles,
      mathSolved:true,mathPrev:0
    };
    gRef.current=g;

    for(si=0;si<STOPS.length;si++){var wc=0;
      for(var pi=0;pi<g.pax.length;pi++)if(g.pax[pi].origin===si&&!g.pax[pi].on&&!g.pax[pi].done)wc++;
      for(fi=0;fi<waitFigs[si].length;fi++)waitFigs[si][fi].visible=fi<wc;}

    var camOff=new THREE.Vector3(0,12,20);
    var camLk=new THREE.Vector3(bus.position.x,2.5,bus.position.z);

    g.reset=function(){
      g.pax=newPax();g.speed=0;g.steer=0;g.onBus=0;g.delivered=0;g.score=0;
      g.nearIdx=-1;g.stoppedIdx=-1;g.time=0;g.nextWp=1;g.visited={};
      g.crashed=false;g.crashTimer=0;g.damage=0;g.camShake=0;
      g.mathSolved=true;g.mathPrev=0;
      g.prevX=R[0][0];g.prevZ=R[0][1];g.heading=initAng;
      bus.position.set(R[0][0],0,R[0][1]);bus.rotation.y=initAng;bus.rotation.z=0;bus.rotation.x=0;
      for(var ai=alightFigs.length-1;ai>=0;ai--)recycleAlightFig(alightFigs[ai]);
      for(var ssi=0;ssi<STOPS.length;ssi++){var wwc=0;
        for(var ppi=0;ppi<g.pax.length;ppi++)if(g.pax[ppi].origin===ssi&&!g.pax[ppi].on&&!g.pax[ppi].done)wwc++;
        for(var ffi=0;ffi<waitFigs[ssi].length;ffi++){var wf=waitFigs[ssi][ffi];wf.visible=ffi<wwc;
          wf.position.set(wf.userData.homeX,0,wf.userData.homeZ);wf.position.y=0;wf.rotation.y=0;
          wf.userData.walkState="idle";wf.userData.walkProgress=0;wf.userData.paxIndex=-1;}}
    };

    g.door=function(){
      var st=stateRef.current;
      if(st==="playing"&&g.nearIdx>=0&&Math.abs(g.speed)<2){
        g.speed=0;g.stoppedIdx=g.nearIdx;g.visited[g.nearIdx]=true;
        var ssi=g.nearIdx,bOff=0,bOn=0;
        var previousOnBus=g.onBus;
        if(audioRef.current)audioRef.current.playDoor();
        var sp=stopPositions[ssi];
        var doorX=bus.position.x+sp.nx*2,doorZ=bus.position.z+sp.nz*2;
        /* alighting — score immediately, animate walk to shelter */
        for(var ppi=0;ppi<g.pax.length;ppi++){var pp=g.pax[ppi];
          if(pp.on&&pp.dest===ssi&&!pp.done){
            bOff++;g.delivered++;g.score+=100;
            var af=createAlightFig();af.position.set(doorX,0,doorZ);
            af.userData.walkState="alighting";af.userData.walkProgress=0;
            af.userData.walkStartX=doorX;af.userData.walkStartZ=doorZ;
            af.userData.walkEndX=sp.sx-1.2+bOff*0.85;af.userData.walkEndZ=sp.sz+0.5;
            af.userData.walkSpeed=5;af.userData.paxIndex=ppi;alightFigs.push(af);}}
        /* boarding — animate walk from shelter to bus door */
        var bfi=0;
        for(var ppi2=0;ppi2<g.pax.length;ppi2++){var pp2=g.pax[ppi2];
          if(pp2.origin===ssi&&!pp2.on&&!pp2.done){bOn++;
            while(bfi<waitFigs[ssi].length){var wf=waitFigs[ssi][bfi];bfi++;
              if(wf.visible&&wf.userData.walkState==="idle"){
                wf.userData.walkState="boarding";wf.userData.walkProgress=0;
                wf.userData.walkStartX=wf.position.x;wf.userData.walkStartZ=wf.position.z;
                wf.userData.walkEndX=doorX;wf.userData.walkEndZ=doorZ;
                wf.userData.walkSpeed=5;wf.userData.paxIndex=ppi2;break;}}}}
        if(bOn>0&&audioRef.current)audioRef.current.playBell();
        g.mathPrev=previousOnBus;
        g.mathSolved=(bOn===0&&bOff===0);
        setMathInput("");setMathWrong(false);
        if(ssi===STOPS.length-1){
          /* terminal: finish animations instantly */
          for(var ai3=alightFigs.length-1;ai3>=0;ai3--){
            var af2=alightFigs[ai3],pi9=af2.userData.paxIndex;
            if(pi9>=0){g.pax[pi9].done=true;g.pax[pi9].on=false;}recycleAlightFig(af2);}
          for(var wi3=0;wi3<waitFigs[ssi].length;wi3++){var wf2=waitFigs[ssi][wi3];
            if(wf2.userData.walkState==="boarding"){var pi10=wf2.userData.paxIndex;
              if(pi10>=0)g.pax[pi10].on=true;wf2.visible=false;
              wf2.position.set(wf2.userData.homeX,0,wf2.userData.homeZ);
              wf2.userData.walkState="idle";wf2.userData.walkProgress=0;}}
          var cnt=0;for(var ppi3=0;ppi3<g.pax.length;ppi3++)if(g.pax[ppi3].on)cnt++;
          var rem=0;for(var ppi4=0;ppi4<g.pax.length;ppi4++)if(g.pax[ppi4].on&&!g.pax[ppi4].done)rem++;
          g.score-=rem*50;g.onBus=0;stateRef.current="complete";
          setUi({phase:"complete",spd:0,score:g.score,onBus:0,del:g.delivered,tot:g.pax.length,
            near:null,stopN:"",nextS:"",prog:1,time:g.time,bOn:bOn,bOff:bOff,crashed:false,damage:g.damage,mathPrev:0,mathSolved:true});return;}
        var cnt2=0;for(var ppi5=0;ppi5<g.pax.length;ppi5++)if(g.pax[ppi5].on)cnt2++;
        g.onBus=cnt2;
        stateRef.current="stopped";
        setUi(function(prev){return{phase:"stopped",spd:0,score:g.score,onBus:g.onBus,del:g.delivered,
          tot:g.pax.length,near:null,stopN:STOPS[ssi].n,nextS:prev.nextS,prog:prev.prog,time:g.time,bOn:bOn,bOff:bOff,crashed:false,damage:g.damage,
          mathPrev:previousOnBus,mathSolved:(bOn===0&&bOff===0)};});
      }else if(st==="stopped"){
        if(!g.mathSolved)return;
        if(audioRef.current)audioRef.current.playDoor();
        /* finish any remaining walk animations instantly */
        var ssi2=g.stoppedIdx;
        if(ssi2>=0){
          for(var wi4=0;wi4<waitFigs[ssi2].length;wi4++){var wf3=waitFigs[ssi2][wi4];
            if(wf3.userData.walkState==="boarding"){var pi11=wf3.userData.paxIndex;
              if(pi11>=0)g.pax[pi11].on=true;wf3.visible=false;
              wf3.position.set(wf3.userData.homeX,0,wf3.userData.homeZ);
              wf3.userData.walkState="idle";wf3.userData.walkProgress=0;}}
          for(var ai4=alightFigs.length-1;ai4>=0;ai4--){var af3=alightFigs[ai4],pi12=af3.userData.paxIndex;
            if(pi12>=0){g.pax[pi12].done=true;g.pax[pi12].on=false;}recycleAlightFig(af3);}
          var cnt3=0;for(var ppi6=0;ppi6<g.pax.length;ppi6++)if(g.pax[ppi6].on)cnt3++;
          g.onBus=cnt3;}
        g.stoppedIdx=-1;stateRef.current="playing";
        setUi(function(prev){return Object.assign({},prev,{phase:"playing",stopN:""});});
      }
    };

    function onSpace(e){
      if(e.key===" "){e.preventDefault();if(gRef.current)gRef.current.door();}
      if(e.key==="h"||e.key==="H"){if(audioRef.current)audioRef.current.playHorn();}
    }
    window.addEventListener("keydown",onSpace);

    /* ══ ANIMATION ══ */
    var clock=new THREE.Clock();
    var animId;

    function animate(){
      animId=requestAnimationFrame(animate);
      var dt=Math.min(clock.getDelta(),0.05);
      var keys=keysRef.current;
      var ph=stateRef.current;

      if(ph==="playing"){
        g.time+=dt;
        if(g.crashTimer>0)g.crashTimer=Math.max(g.crashTimer-dt,0);
        if(g.camShake>0)g.camShake=Math.max(g.camShake-dt*3,0);

        /* steer */
        if(keys["arrowleft"]||keys["a"])g.steer=Math.min(g.steer+2.5*dt,0.7);
        else if(keys["arrowright"]||keys["d"])g.steer=Math.max(g.steer-2.5*dt,-0.7);
        else{if(Math.abs(g.steer)<0.02)g.steer=0;else g.steer-=Math.sign(g.steer)*3.5*dt;}

        /* speed */
        if(g.crashed){
          if(keys["arrowdown"]||keys["s"])g.speed=Math.max(g.speed-18*dt,-8);
          else if(keys["arrowup"]||keys["w"])g.speed=Math.min(g.speed+6*dt,3);
          else{if(g.speed>0)g.speed=Math.max(g.speed-5*dt,0);else g.speed=Math.min(g.speed+3*dt,0);}
        }else{
          if(keys["arrowup"]||keys["w"])g.speed=Math.min(g.speed+14*dt,30);
          else if(keys["arrowdown"]||keys["s"])g.speed=Math.max(g.speed-22*dt,-6);
          else{if(g.speed>0)g.speed=Math.max(g.speed-5*dt,0);else g.speed=Math.min(g.speed+5*dt,0);}
        }

        g.prevX=bus.position.x;g.prevZ=bus.position.z;
        var tf=Math.min(Math.abs(g.speed)/12,1)*g.steer;
        g.heading+=tf*dt*2;
        bus.position.x-=Math.sin(g.heading)*g.speed*dt;
        bus.position.z-=Math.cos(g.heading)*g.speed*dt;
        bus.rotation.y=g.heading;
        bus.rotation.z=-g.steer*Math.min(Math.abs(g.speed)/30,1)*0.04;

        /* ── COLLISION ── */
        var bxp=bus.position.x,bzp=bus.position.z;
        var sinH=Math.sin(g.heading),cosH=Math.cos(g.heading);
        var testPts=[];
        for(var ci2=-1;ci2<=1;ci2+=2)for(var cj=-1;cj<=1;cj+=2){
          testPts.push({x:bxp-sinH*4.2*cj+cosH*1.8*ci2,z:bzp-cosH*4.2*cj-sinH*1.8*ci2});}
        testPts.push({x:bxp-sinH*4.2,z:bzp-cosH*4.2});
        testPts.push({x:bxp+sinH*4.2,z:bzp+cosH*4.2});

        var hit=false;
        for(var oi=0;oi<obstacles.length;oi++){
          var ob=obstacles[oi];
          /* broad-phase: skip obstacles far from bus */
          if(dd(bxp,bzp,ob.x,ob.z)>30)continue;
          if(ob.r!==undefined){
            var hitR=ob.r+2.0;
            for(var pi2=0;pi2<testPts.length;pi2++){if(dd(testPts[pi2].x,testPts[pi2].z,ob.x,ob.z)<hitR){hit=true;break;}}
            if(!hit&&dd(bxp,bzp,ob.x,ob.z)<hitR)hit=true;
          }else{
            for(var pi3=0;pi3<testPts.length;pi3++){var pp3=testPts[pi3];
              if(pp3.x>ob.x-ob.hw&&pp3.x<ob.x+ob.hw&&pp3.z>ob.z-ob.hd&&pp3.z<ob.z+ob.hd){hit=true;break;}}
            if(!hit&&bxp>ob.x-ob.hw&&bxp<ob.x+ob.hw&&bzp>ob.z-ob.hd&&bzp<ob.z+ob.hd)hit=true;
          }
          if(hit)break;
        }

        if(hit&&!g.crashed){
          bus.position.x=g.prevX;bus.position.z=g.prevZ;
          var impactSpd=Math.abs(g.speed);
          g.speed=0;g.crashed=true;g.crashTimer=2.5;
          g.camShake=Math.min(impactSpd/15,1.0);
          g.score=Math.max(g.score-Math.round(impactSpd*2),0);
          g.damage++;
          if(audioRef.current)audioRef.current.playCrash(Math.min(impactSpd/30,1));
        }else if(g.crashed&&!hit){g.crashed=false;}

        if(g.crashTimer>0){
          bus.rotation.z+=Math.sin(g.crashTimer*25)*g.crashTimer*0.03;
          bus.rotation.x=Math.sin(g.crashTimer*18)*g.crashTimer*0.015;
        }else{bus.rotation.x=0;}

        /* audio */
        if(audioRef.current){audioRef.current.updateEngine(g.speed,30);audioRef.current.updateMusic(dt);}

        /* near stop */
        g.nearIdx=-1;
        for(var ssi2=0;ssi2<STOPS.length;ssi2++){var ww=R[STOPS[ssi2].i];
          if(dd(bus.position.x,bus.position.z,ww[0],ww[1])<10){g.nearIdx=ssi2;break;}}

        if(g.nextWp<R.length){var nw=R[g.nextWp];
          if(dd(bus.position.x,bus.position.z,nw[0],nw[1])<14)g.nextWp=Math.min(g.nextWp+1,R.length-1);}

        var nsn="Terminal";
        for(var ssi3=0;ssi3<STOPS.length;ssi3++)if(!g.visited[ssi3]){nsn=STOPS[ssi3].n;break;}

        setUi({phase:"playing",spd:Math.abs(g.speed),score:g.score,onBus:g.onBus,del:g.delivered,
          tot:g.pax.length,near:g.nearIdx>=0?STOPS[g.nearIdx].n:null,stopN:"",nextS:nsn,
          prog:g.nextWp/(R.length-1),time:g.time,bOn:0,bOff:0,crashed:g.crashed,damage:g.damage,mathPrev:g.mathPrev,mathSolved:g.mathSolved});
      }

      /* update wait figs and walk animations */
      for(var ssi4=0;ssi4<STOPS.length;ssi4++){var wwc2=0;
        for(var ppi5=0;ppi5<g.pax.length;ppi5++)if(g.pax[ppi5].origin===ssi4&&!g.pax[ppi5].on&&!g.pax[ppi5].done)wwc2++;
        var bc4=0;
        for(var ffi2=0;ffi2<waitFigs[ssi4].length;ffi2++){var wfig=waitFigs[ssi4][ffi2];
          if(wfig.userData.walkState==="boarding"){bc4++;
            var wd=dd(wfig.userData.walkStartX,wfig.userData.walkStartZ,wfig.userData.walkEndX,wfig.userData.walkEndZ);
            wfig.userData.walkProgress+=dt*wfig.userData.walkSpeed/Math.max(wd,0.1);
            if(wfig.userData.walkProgress>=1){var pidx=wfig.userData.paxIndex;
              if(pidx>=0)g.pax[pidx].on=true;wfig.visible=false;
              wfig.position.set(wfig.userData.homeX,0,wfig.userData.homeZ);wfig.position.y=0;wfig.rotation.y=0;
              wfig.userData.walkState="idle";wfig.userData.walkProgress=0;wfig.userData.paxIndex=-1;
              var cn=0;for(var pk=0;pk<g.pax.length;pk++)if(g.pax[pk].on)cn++;g.onBus=cn;
            }else{var pr=wfig.userData.walkProgress;
              wfig.position.x=wfig.userData.walkStartX+(wfig.userData.walkEndX-wfig.userData.walkStartX)*pr;
              wfig.position.z=wfig.userData.walkStartZ+(wfig.userData.walkEndZ-wfig.userData.walkStartZ)*pr;
              wfig.position.y=Math.sin(pr*Math.PI*4)*0.08;
              wfig.rotation.y=Math.atan2(wfig.userData.walkEndX-wfig.userData.walkStartX,wfig.userData.walkEndZ-wfig.userData.walkStartZ);}}}
        var idleShow=wwc2-bc4,shown=0;
        for(var ffi3=0;ffi3<waitFigs[ssi4].length;ffi3++){var wf4=waitFigs[ssi4][ffi3];
          if(wf4.userData.walkState==="idle"){wf4.visible=shown<idleShow;shown++;}}}
      /* animate alighting figures */
      for(var ai5=alightFigs.length-1;ai5>=0;ai5--){var afig=alightFigs[ai5];
        var ad=dd(afig.userData.walkStartX,afig.userData.walkStartZ,afig.userData.walkEndX,afig.userData.walkEndZ);
        afig.userData.walkProgress+=dt*afig.userData.walkSpeed/Math.max(ad,0.1);
        if(afig.userData.walkProgress>=1){var pidx2=afig.userData.paxIndex;
          if(pidx2>=0){g.pax[pidx2].done=true;g.pax[pidx2].on=false;}
          recycleAlightFig(afig);
          var cn2=0;for(var pk2=0;pk2<g.pax.length;pk2++)if(g.pax[pk2].on)cn2++;g.onBus=cn2;
        }else{var pr2=afig.userData.walkProgress;
          afig.position.x=afig.userData.walkStartX+(afig.userData.walkEndX-afig.userData.walkStartX)*pr2;
          afig.position.z=afig.userData.walkStartZ+(afig.userData.walkEndZ-afig.userData.walkStartZ)*pr2;
          afig.position.y=Math.sin(pr2*Math.PI*4)*0.08;
          afig.rotation.y=Math.atan2(afig.userData.walkEndX-afig.userData.walkStartX,afig.userData.walkEndZ-afig.userData.walkStartZ);}}

      /* pulse stop rings */
      var pt2=performance.now()*0.003;
      for(var ri2=0;ri2<stopRings.length;ri2++){
        stopRings[ri2].material.opacity=0.2+Math.sin(pt2+ri2*0.9)*0.15;
        stopRings[ri2].material.emissiveIntensity=0.3+Math.sin(pt2+ri2*0.9)*0.2;
      }

      /* clouds */
      for(var ci3=0;ci3<clouds.length;ci3++){clouds[ci3].position.x+=dt*(0.5+ci3*0.05);if(clouds[ci3].position.x>450)clouds[ci3].position.x=-350;}

      /* camera */
      var dOff=new THREE.Vector3(Math.sin(g.heading)*22,10+Math.abs(g.speed)*0.12,Math.cos(g.heading)*22);
      camOff.lerp(dOff,dt*2.5);
      var ct=new THREE.Vector3(bus.position.x+camOff.x,camOff.y,bus.position.z+camOff.z);
      if(g.camShake>0){var sa=g.camShake*1.5;
        ct.x+=Math.sin(performance.now()*0.05)*sa;ct.y+=Math.cos(performance.now()*0.07)*sa*0.5;ct.z+=Math.sin(performance.now()*0.06)*sa;}
      camera.position.lerp(ct,dt*4);
      var la2=new THREE.Vector3(bus.position.x-Math.sin(g.heading)*8,2.5,bus.position.z-Math.cos(g.heading)*8);
      camLk.lerp(la2,dt*5);camera.lookAt(camLk);

      renderer.render(scene,camera);
    }
    animate();

    function onResize(){W=el.clientWidth;H=el.clientHeight;if(W<10||H<10)return;
      renderer.setSize(W,H);camera.aspect=W/H;camera.updateProjectionMatrix();}
    window.addEventListener("resize",onResize);
    return function(){cancelAnimationFrame(animId);window.removeEventListener("resize",onResize);
      window.removeEventListener("keydown",onSpace);renderer.dispose();
      if(audioRef.current){audioRef.current.dispose();audioRef.current=null;}
      if(el.contains(renderer.domElement))el.removeChild(renderer.domElement);};
  },[]);

  var startPlay=useCallback(function(){
    ensureAudio();
    if(gRef.current)gRef.current.reset();
    stateRef.current="playing";
    setUi(function(prev){return Object.assign({},prev,{phase:"playing",crashed:false,damage:0});});
  },[]);

  var doDoor=useCallback(function(){
    ensureAudio();
    if(gRef.current)gRef.current.door();
  },[]);

  var toggleMute=useCallback(function(){
    if(audioRef.current){var m2=!audioRef.current.getMuted();audioRef.current.setMute(m2);setMuted(m2);}
  },[]);

  function checkMath(){
    var g2=gRef.current;if(!g2)return;
    var answer=parseInt(mathInput,10);
    var correct=ui.mathPrev-ui.bOff+ui.bOn;
    if(answer===correct){
      g2.mathSolved=true;
      if(audioRef.current)audioRef.current.playBell();
      setUi(function(prev){return Object.assign({},prev,{mathSolved:true});});
      setMathInput("");setMathWrong(false);
    }else{
      setMathWrong(true);
      setTimeout(function(){setMathWrong(false);},600);
    }
  }

  var tS=function(k){keysRef.current[k]=true;};
  var tE=function(k){keysRef.current[k]=false;};
  var phase=ui.phase;

  var bs=function(c,bg){return{background:bg,border:"2px solid "+c,color:c,
    fontFamily:"'Courier New',monospace",fontSize:13,fontWeight:"bold",
    padding:"10px 16px",borderRadius:8,cursor:"pointer",
    userSelect:"none",touchAction:"none",minWidth:48,textAlign:"center"};};

  return(
    <div style={{width:"100%",height:"100vh",background:"#000",position:"relative",overflow:"hidden",fontFamily:"'Courier New',monospace"}}>
      <style>{`@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}50%{transform:translateX(6px)}75%{transform:translateX(-4px)}}`}</style>
      <div ref={canvasRef} style={{width:"100%",height:"100%",position:"absolute",top:0,left:0,
        filter:phase==="menu"?"blur(3px) brightness(0.35)":phase==="complete"?"blur(4px) brightness(0.3)":"none",
        transition:"filter 0.5s"}} />

      {/* MUTE BUTTON - always visible during gameplay */}
      {(phase==="playing"||phase==="stopped")&&(
        <button onClick={toggleMute} style={{position:"absolute",top:12,right:12,zIndex:20,
          background:"rgba(0,0,0,0.5)",border:"1px solid rgba(255,255,255,0.15)",color:"#ccc",
          borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:16,
          fontFamily:"'Courier New',monospace"}}>{muted?"🔇":"🔊"}</button>
      )}

      {phase==="menu"&&(
        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",zIndex:10}}>
          <div style={{textAlign:"center",maxWidth:520,padding:20}}>
            <div style={{fontSize:68,marginBottom:4}}>🚌</div>
            <h1 style={{fontSize:42,margin:"0 0 2px",letterSpacing:5,color:"#e8b400"}}>BUS ROUTE 3D</h1>
            <p style={{color:"#556",fontSize:11,margin:"0 0 28px",letterSpacing:3}}>CITY TRANSIT SIMULATOR</p>
            <div style={{background:"rgba(0,0,0,0.5)",borderRadius:12,padding:"20px 28px",marginBottom:28,
              textAlign:"left",lineHeight:"2.1em",fontSize:13,border:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{color:"#e8b400",fontWeight:"bold",marginBottom:8,fontSize:13,letterSpacing:2}}>CONTROLS</div>
              <div><span style={{color:"#ff8c00",display:"inline-block",width:75}}>W / ↑</span> Accelerate</div>
              <div><span style={{color:"#ff8c00",display:"inline-block",width:75}}>S / ↓</span> Brake</div>
              <div><span style={{color:"#ff8c00",display:"inline-block",width:75}}>A / ←</span> Steer Left</div>
              <div><span style={{color:"#ff8c00",display:"inline-block",width:75}}>D / →</span> Steer Right</div>
              <div><span style={{color:"#ff8c00",display:"inline-block",width:75}}>SPACE</span> Doors at stops</div>
              <div><span style={{color:"#ff8c00",display:"inline-block",width:75}}>H</span> Horn</div>
              <div style={{marginTop:10,color:"#888",fontSize:11,lineHeight:"1.6em"}}>
                Follow blue arrows. Stop at green rings to pick up passengers. 100 pts per delivery.
              </div>
              <div style={{marginTop:6,color:"#6a8",fontSize:11}}>🔊 Engine sounds, music &amp; SFX included</div>
            </div>
            <button onClick={startPlay} style={{
              background:"linear-gradient(135deg,#e8b400,#ff6b00)",border:"none",color:"#111",
              fontFamily:"'Courier New',monospace",fontSize:19,fontWeight:"bold",padding:"16px 52px",
              borderRadius:10,cursor:"pointer",letterSpacing:3}}>START ROUTE ▶</button>
          </div>
        </div>
      )}

      {phase==="complete"&&(function(){
        var miss=ui.tot-ui.del;
        var pct=ui.tot>0?ui.del/ui.tot:0;
        var rating=pct===1?"⭐⭐⭐ PERFECT":pct>0.7?"⭐⭐ GREAT":pct>0.4?"⭐ DECENT":"NEEDS WORK";
        return(
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",zIndex:10}}>
            <div style={{textAlign:"center",maxWidth:440,padding:20}}>
              <div style={{fontSize:52,marginBottom:8}}>🏁</div>
              <h1 style={{fontSize:32,margin:"0 0 4px",color:"#e8b400",letterSpacing:3}}>ROUTE COMPLETE</h1>
              <p style={{color:"#ff8c00",fontSize:18,margin:"6px 0 22px"}}>{rating}</p>
              <div style={{background:"rgba(0,0,0,0.5)",borderRadius:12,padding:22,marginBottom:28,
                lineHeight:"2.3em",fontSize:15,border:"1px solid rgba(255,255,255,0.06)"}}>
                <div>Score: <span style={{color:"#e8b400",fontWeight:"bold"}}>{ui.score}</span></div>
                <div>Delivered: <span style={{color:"#2ecc71"}}>{ui.del}</span> / {ui.tot}</div>
                {miss>0&&<div>Missed: <span style={{color:"#e74c3c"}}>{miss}</span></div>}
                {ui.damage>0&&<div>Collisions: <span style={{color:"#ff8844"}}>{ui.damage}</span></div>}
                <div>Time: <span style={{color:"#3498db"}}>{Math.floor(ui.time)}s</span></div>
              </div>
              <button onClick={startPlay} style={{
                background:"linear-gradient(135deg,#e8b400,#ff6b00)",border:"none",color:"#111",
                fontFamily:"'Courier New',monospace",fontSize:17,fontWeight:"bold",padding:"14px 44px",
                borderRadius:10,cursor:"pointer",letterSpacing:2}}>DRIVE AGAIN ▶</button>
            </div>
          </div>);
      })()}

      {(phase==="playing"||phase==="stopped")&&(
        <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:5}}>
          <div style={{position:"absolute",top:0,left:0,right:0,padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div style={{background:"rgba(0,0,0,0.55)",borderRadius:10,padding:"10px 16px",minWidth:170,backdropFilter:"blur(4px)"}}>
              <div style={{color:"#777",fontSize:9,letterSpacing:2}}>SPEED</div>
              <div style={{display:"flex",alignItems:"baseline",gap:4}}>
                <span style={{color:"#fff",fontSize:24,fontWeight:"bold"}}>{Math.round(ui.spd*3.6)}</span>
                <span style={{color:"#555",fontSize:10}}>km/h</span>
              </div>
              <div style={{background:"#222",borderRadius:3,height:4,marginTop:3,overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:3,transition:"width 0.1s",
                  width:Math.min(ui.spd/30*100,100)+"%",
                  background:ui.crashed?"#ff3333":ui.spd>21?"#e74c3c":ui.spd>12?"#f39c12":"#2ecc71"}} />
              </div>
              <div style={{marginTop:8}}>
                <div style={{color:"#777",fontSize:9,letterSpacing:2}}>ROUTE</div>
                <div style={{background:"#222",borderRadius:3,height:4,overflow:"hidden"}}>
                  <div style={{height:"100%",borderRadius:3,background:"#3498db",width:Math.round(ui.prog*100)+"%",transition:"width 0.3s"}} />
                </div>
                <div style={{color:"#444",fontSize:9,marginTop:1}}>{Math.round(ui.prog*100)}%</div>
              </div>
            </div>
            <div style={{background:"rgba(0,0,0,0.55)",borderRadius:10,padding:"7px 20px",textAlign:"center",backdropFilter:"blur(4px)"}}>
              <div style={{color:"#777",fontSize:9,letterSpacing:2}}>NEXT STOP</div>
              <div style={{color:"#00ccff",fontSize:13,fontWeight:"bold",marginTop:1}}>{ui.nextS}</div>
            </div>
            <div style={{background:"rgba(0,0,0,0.55)",borderRadius:10,padding:"10px 16px",textAlign:"right",minWidth:130,backdropFilter:"blur(4px)"}}>
              <div style={{color:"#e8b400",fontSize:19,fontWeight:"bold"}}>{ui.score}</div>
              <div style={{color:"#555",fontSize:9,letterSpacing:2}}>SCORE</div>
              <div style={{display:"flex",justifyContent:"flex-end",gap:12,marginTop:6}}>
                <div><div style={{color:"#f39c12",fontSize:18,fontWeight:"bold"}}>🚌 {ui.onBus}</div><div style={{color:"#777",fontSize:9}}>ON BUS</div></div>
                <div><div style={{color:"#2ecc71",fontSize:14,fontWeight:"bold"}}>{ui.del}</div><div style={{color:"#555",fontSize:8}}>DONE</div></div>
              </div>
              <div style={{color:"#333",fontSize:9,marginTop:5}}>{Math.floor(ui.time)}s</div>
            </div>
          </div>

          {phase==="playing"&&ui.near&&ui.spd<5&&!ui.crashed&&(
            <div style={{position:"absolute",bottom:75,left:"50%",transform:"translateX(-50%)",
              background:"rgba(0,0,0,0.8)",borderRadius:11,padding:"11px 24px",border:"2px solid #e8b400",textAlign:"center",backdropFilter:"blur(6px)"}}>
              <div style={{color:"#e8b400",fontSize:13,fontWeight:"bold"}}>🚏 {ui.near}</div>
              <div style={{color:"#aaa",fontSize:10,marginTop:2}}>Stop &amp; press SPACE to open doors</div>
            </div>
          )}

          {phase==="playing"&&ui.crashed&&(
            <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",textAlign:"center"}}>
              <div style={{color:"#ff3333",fontSize:34,fontWeight:"bold",
                textShadow:"0 0 20px rgba(255,0,0,0.8),0 0 40px rgba(255,0,0,0.4)",letterSpacing:6}}>
                💥 CRASH!</div>
              <div style={{color:"#ffaa00",fontSize:13,marginTop:8,textShadow:"0 0 10px rgba(0,0,0,0.9)"}}>
                Hold ↓/S to reverse out!</div>
            </div>
          )}

          {ui.damage>0&&(
            <div style={{position:"absolute",top:78,left:"50%",transform:"translateX(-50%)",
              background:"rgba(140,25,25,0.6)",borderRadius:8,padding:"3px 12px",backdropFilter:"blur(4px)"}}>
              <span style={{color:"#ff9999",fontSize:10}}>⚠ {ui.damage} collision{ui.damage>1?"s":""}</span>
            </div>
          )}

          {phase==="stopped"&&(
            <div style={{position:"absolute",bottom:75,left:"50%",transform:"translateX(-50%)",
              background:"rgba(0,0,0,0.9)",borderRadius:13,padding:"18px 30px",
              border:ui.mathSolved?"2px solid #2ecc71":"2px solid #e8b400",
              textAlign:"center",minWidth:260,backdropFilter:"blur(8px)",pointerEvents:"auto"}}>
              <div style={{color:"#2ecc71",fontSize:15,fontWeight:"bold",marginBottom:10}}>🚏 {ui.stopN}</div>
              {ui.bOff===0&&ui.bOn===0?(
                <div>
                  <div style={{color:"#777",fontSize:12,marginBottom:8}}>No passengers here</div>
                  <div style={{color:"#e8b400",fontSize:11}}>Press SPACE to close doors</div>
                </div>
              ):!ui.mathSolved?(
                <div>
                  <div style={{color:"#aac",fontSize:13,marginBottom:6}}>🚌 You had <span style={{color:"#f39c12",fontWeight:"bold",fontSize:16}}>{ui.mathPrev}</span> on the bus</div>
                  <div style={{display:"flex",justifyContent:"center",gap:20,marginBottom:10}}>
                    {ui.bOff>0&&<div style={{color:"#e74c3c",fontSize:15,fontWeight:"bold"}}>⬇ {ui.bOff} got off</div>}
                    {ui.bOn>0&&<div style={{color:"#2ecc71",fontSize:15,fontWeight:"bold"}}>⬆ {ui.bOn} got on</div>}
                  </div>
                  <div style={{color:"#e8b400",fontSize:14,fontWeight:"bold",marginBottom:8}}>How many are on the bus now?</div>
                  <div style={{display:"flex",justifyContent:"center",gap:8,alignItems:"center"}}>
                    <input type="number" inputMode="numeric" pattern="[0-9]*" value={mathInput}
                      onChange={function(e){setMathInput(e.target.value);}}
                      onKeyDown={function(e){e.stopPropagation();if(e.key==="Enter")checkMath();}}
                      autoFocus
                      style={{width:64,padding:"8px 10px",fontSize:20,fontWeight:"bold",textAlign:"center",
                        borderRadius:8,border:mathWrong?"2px solid #e74c3c":"2px solid #e8b400",
                        background:"rgba(255,255,255,0.1)",color:"#fff",outline:"none",
                        fontFamily:"'Courier New',monospace",
                        animation:mathWrong?"shake 0.4s ease":"none"}} />
                    <button onClick={checkMath} style={{padding:"8px 16px",fontSize:14,fontWeight:"bold",
                      borderRadius:8,border:"none",cursor:"pointer",
                      background:"linear-gradient(135deg,#e8b400,#ff6b00)",color:"#111",
                      fontFamily:"'Courier New',monospace"}}>Check</button>
                  </div>
                  {mathWrong&&<div style={{color:"#e74c3c",fontSize:12,marginTop:6}}>Not quite! Try again</div>}
                </div>
              ):(
                <div>
                  <div style={{display:"flex",justifyContent:"center",gap:20,marginBottom:6}}>
                    {ui.bOff>0&&<div style={{color:"#e74c3c",fontSize:15,fontWeight:"bold"}}>⬇ {ui.bOff} got off</div>}
                    {ui.bOn>0&&<div style={{color:"#2ecc71",fontSize:15,fontWeight:"bold"}}>⬆ {ui.bOn} got on</div>}
                  </div>
                  <div style={{color:"#2ecc71",fontSize:16,fontWeight:"bold",marginBottom:6}}>Correct! {ui.mathPrev-ui.bOff+ui.bOn} passengers on the bus</div>
                  <div style={{color:"#e8b400",fontSize:11}}>Press SPACE to close doors &amp; continue</div>
                </div>
              )}
            </div>
          )}

          <div style={{position:"absolute",bottom:8,left:8,right:8,display:"flex",justifyContent:"space-between",pointerEvents:"auto"}}>
            <div style={{display:"flex",gap:5,alignItems:"center"}}>
              <button onPointerDown={function(){tS("arrowleft")}} onPointerUp={function(){tE("arrowleft")}} onPointerLeave={function(){tE("arrowleft")}} style={bs("#3498db","rgba(52,152,219,0.15)")}>◀</button>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                <button onPointerDown={function(){ensureAudio();tS("arrowup")}} onPointerUp={function(){tE("arrowup")}} onPointerLeave={function(){tE("arrowup")}} style={bs("#2ecc71","rgba(46,204,113,0.15)")}>▲ GAS</button>
                <button onPointerDown={function(){tS("arrowdown")}} onPointerUp={function(){tE("arrowdown")}} onPointerLeave={function(){tE("arrowdown")}} style={bs("#e74c3c","rgba(231,76,60,0.15)")}>▼ BRK</button>
              </div>
              <button onPointerDown={function(){tS("arrowright")}} onPointerUp={function(){tE("arrowright")}} onPointerLeave={function(){tE("arrowright")}} style={bs("#3498db","rgba(52,152,219,0.15)")}>▶</button>
            </div>
            <div style={{display:"flex",gap:5,alignItems:"center"}}>
              <button onClick={function(){ensureAudio();if(audioRef.current)audioRef.current.playHorn();}} style={bs("#ff6600","rgba(255,102,0,0.15)")}>📯</button>
              <button onClick={function(){ensureAudio();doDoor();}} style={bs("#e8b400","rgba(232,180,0,0.15)")}>🚪 DOORS</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
