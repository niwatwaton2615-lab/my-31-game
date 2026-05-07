<script>
  import { supabase } from '$lib/supabaseClient';
  import { onMount } from 'svelte';

  // --- States ---
  let playerName = $state("");
  let roomId = $state("31-ROOM-01");
  let isJoined = $state(false);
  let players = $state([]);
  let gameState = $state(null);
  let drawnCard = $state(null); 
  let isLoading = $state(false);

  // --- Derived States (ระบบคำนวณอัตโนมัติ) ---
  let me = $derived(players.find(p => p.name === playerName));
  let isHost = $derived(players.length > 0 && players[0].name === playerName);
  let isMyTurn = $derived(gameState && me && gameState.current_turn_id === me.id);

  // คำนวณแต้มเกม 31 (รวมเฉพาะดอกเดียวกันที่สูงที่สุด)
  let myScore = $derived.by(() => {
    if (!me || !me.hand || me.hand.length === 0) return 0;
    const scores = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 };
    me.hand.forEach(c => { if(c) scores[c.suit] += c.value; });
    return Math.max(...Object.values(scores));
  });

  // --- Functions ---
  async function fetchAll() {
    const { data: pData } = await supabase.from('players').select('*').eq('room_id', roomId).order('created_at', { ascending: true });
    players = pData || [];
    const { data: gData } = await supabase.from('game_rooms').select('*').eq('room_id', roomId).single();
    gameState = gData;
  }

  function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const labels = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const values = [11, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10];
    let deck = [];
    suits.forEach(s => labels.forEach((l, i) => deck.push({ display: l + s, value: values[i], suit: s })));
    return deck.sort(() => Math.random() - 0.5);
  }

  async function joinGame() {
    if (!playerName.trim()) return alert("กรุณาใส่ชื่อ");
    isLoading = true;
    const { error } = await supabase.from('players').insert([{ name: playerName, room_id: roomId, hand: [] }]);
    if (!error) { isJoined = true; fetchAll(); }
    isLoading = false;
  }

  async function leaveGame() {
    await supabase.from('players').delete().eq('name', playerName).eq('room_id', roomId);
    isJoined = false;
    players = [];
    drawnCard = null;
  }

  async function startGame() {
    if (!isHost || players.length < 2) return;
    let deck = createDeck();
    for (let p of players) {
      await supabase.from('players').update({ hand: deck.splice(0, 3) }).eq('id', p.id);
    }
    await supabase.from('game_rooms').upsert({
      room_id: roomId, draw_pile: deck, discard_pile: [deck.shift()], current_turn_id: players[0].id, is_started: true
    });
    drawnCard = null;
  }

  async function draw(fromDeck = true) {
    if (!isMyTurn || drawnCard) return;
    let source = fromDeck ? [...gameState.draw_pile] : [...gameState.discard_pile];
    drawnCard = fromDeck ? source.shift() : source.pop();
    const updateData = fromDeck ? { draw_pile: source } : { discard_pile: source };
    await supabase.from('game_rooms').update(updateData).eq('room_id', roomId);
  }

  async function swap(index) {
    if (!drawnCard || !isMyTurn) return;
    let newHand = [...me.hand];
    let toDiscard = newHand[index];
    newHand[index] = drawnCard;
    await supabase.from('players').update({ hand: newHand }).eq('id', me.id);
    
    const nextP = players[(players.findIndex(p => p.id === me.id) + 1) % players.length];
    await supabase.from('game_rooms').update({
      discard_pile: [...gameState.discard_pile, toDiscard],
      current_turn_id: nextP.id
    }).eq('room_id', roomId);
    drawnCard = null;
  }

  onMount(() => {
    fetchAll();
    const channel = supabase.channel(`room-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public' }, fetchAll)
      .subscribe();
    return () => supabase.removeChannel(channel);
  });
</script>

<main class="container">
  {#if !isJoined}
    <div class="card login-box">
      <h1>🃏 31 ONLINE</h1>
      <div class="input-group">
        <label>ชื่อผู้เล่น</label>
        <input bind:value={playerName} placeholder="ใส่ชื่อ..." />
      </div>
      <div class="input-group">
        <label>รหัสห้อง</label>
        <input bind:value={roomId} />
      </div>
      <button class="btn join" onclick={joinGame} disabled={isLoading}>เข้าเล่นเกม</button>
    </div>
  {:else}
    <div class="game-layout">
      <header class="card">
        <div class="room-info">
          <h2>ห้อง: <span class="highlight">{roomId}</span></h2>
          <p class="turn-status" class:active={isMyTurn}>
            {#if gameState?.is_started}
              {isMyTurn ? "🔥 ตาของคุณแล้ว!" : `รอตาของ ${players.find(p => p.id === gameState.current_turn_id)?.name || '...'}`}
            {:else}
              🕒 รอเริ่มเกม (ต้องมี 2 คนขึ้นไป)
            {/if}
          </p>
        </div>
        <div class="header-actions">
          <button class="btn leave" onclick={leaveGame}>ออกเกม</button>
          {#if isHost && !gameState?.is_started}
            <button class="btn start" onclick={startGame} disabled={players.length < 2}>แจกไพ่ 3 ใบ</button>
          {/if}
        </div>
      </header>

      {#if gameState?.is_started}
        <div class="board card">
          <div class="pile">
            <span>กองจั่ว ({gameState.draw_pile?.length || 0})</span>
            <button class="card-item deck" onclick={() => draw(true)} disabled={!isMyTurn || drawnCard}>?</button>
          </div>
          {#if drawnCard}
            <div class="pile">
              <span>จั่วได้</span>
              <div class="card-item drawn">{drawnCard.display}</div>
            </div>
          {/if}
          <div class="pile">
            <span>กองทิ้ง</span>
            <button class="card-item discard" onclick={() => draw(false)} disabled={!isMyTurn || drawnCard}>
              {gameState.discard_pile[gameState.discard_pile.length - 1]?.display || ""}
            </button>
          </div>
        </div>
      {/if}

      <div class="players-area">
        {#each players as p}
          <div class="player-slot card" class:active-turn={gameState?.current_turn_id === p.id} class:me={p.name === playerName}>
            <div class="p-header">
              {p.name === players[0].name ? '👑' : '👤'} {p.name} {p.name === playerName ? `(คุณ - ${myScore} แต้ม)` : ''}
            </div>
            <div class="hand">
              {#each (p.hand || [null, null, null]) as card, i}
                <button 
                  class="card-item player-card" 
                  class:gold={p.name === playerName}
                  class:can-swap={drawnCard && p.name === playerName}
                  onclick={() => p.name === playerName && swap(i)}
                >
                  {p.name === playerName ? (card?.display ?? '?') : '?'}
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</main>

<style>
  :global(body) { background: #020617; color: white; font-family: 'Kanit', sans-serif; margin: 0; }
  .container { display: flex; justify-content: center; min-height: 100vh; padding: 20px; box-sizing: border-box; }
  .card { background: #1e293b; border-radius: 20px; border: 1px solid #334155; box-shadow: 0 10px 30px rgba(0,0,0,0.4); padding: 20px; }
  
  .login-box { width: 320px; text-align: center; height: fit-content; margin-top: 10vh; }
  h1 { color: #fbbf24; margin-bottom: 2rem; letter-spacing: 2px; }
  .input-group { text-align: left; margin-bottom: 1rem; }
  label { font-size: 0.8rem; color: #94a3b8; margin-left: 5px; }
  input { width: 100%; padding: 12px; background: #0f172a; border: 1px solid #334155; border-radius: 12px; color: white; box-sizing: border-box; }
  
  .game-layout { width: 100%; max-width: 900px; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .highlight { color: #38bdf8; }
  .turn-status.active { color: #fbbf24; font-weight: bold; }
  .header-actions { display: flex; gap: 10px; }

  .board { display: flex; justify-content: center; gap: 40px; margin-bottom: 25px; background: #111827; }
  .pile { display: flex; flex-direction: column; align-items: center; gap: 10px; font-size: 0.8rem; color: #94a3b8; }
  
  .card-item { width: 65px; height: 95px; border-radius: 10px; border: 1px solid #334155; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; font-weight: bold; background: #0f172a; cursor: pointer; transition: 0.2s; }
  .deck { background: #334155; color: white; }
  .drawn { border-color: #fbbf24; color: #fbbf24; box-shadow: 0 0 15px rgba(251, 191, 36, 0.3); }
  .discard { background: #f8fafc; color: #0f172a; }

  .players-area { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
  .player-slot { text-align: center; border-width: 2px; }
  .active-turn { border-color: #fbbf24; background: rgba(251, 191, 36, 0.05); }
  .me { border-color: #10b981; }
  .p-header { font-weight: bold; margin-bottom: 15px; }
  .hand { display: flex; gap: 10px; justify-content: center; }
  .player-card { cursor: default; }
  .gold { border-color: #fbbf24; color: #fbbf24; }
  .can-swap { border: 2px dashed #fbbf24; animation: pulse 1s infinite; cursor: pointer; }

  .btn { padding: 10px 20px; border-radius: 10px; border: none; font-weight: bold; cursor: pointer; }
  .btn.join { width: 100%; background: #10b981; color: white; margin-top: 15px; }
  .btn.start { background: #fbbf24; color: #000; }
  .btn.leave { background: #475569; color: white; }
  .btn.leave:hover { background: #ef4444; }

  @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
</style>