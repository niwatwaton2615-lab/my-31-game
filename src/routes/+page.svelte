<script>
  import { supabase } from '$lib/supabaseClient';
  import { onMount } from 'svelte';

  // --- States ---
  let playerName = $state("");
  let roomId = $state("31-ROOM");
  let isJoined = $state(false);
  let players = $state([]);
  let gameState = $state(null);
  let drawnCard = $state(null); 
  let isLoading = $state(false);

  // --- Derived States ---
  let me = $derived(players.find(p => p.name === playerName));
  let isHost = $derived(players.length > 0 && players[0].name === playerName);
  let isMyTurn = $derived(gameState && me && gameState.current_turn_id === me.id);

  // คำนวณแต้ม 31 (รวมเฉพาะดอกเดียวกันที่สูงที่สุด)
  let myScore = $derived.by(() => {
    if (!me || !me.hand || me.hand.length === 0) return 0;
    const scores = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 };
    me.hand.forEach(c => { if(c) scores[c.suit] += c.value; });
    return Math.max(...Object.values(scores));
  });

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
    if (!playerName.trim()) return;
    isLoading = true;
    const { error } = await supabase.from('players').insert([{ name: playerName, room_id: roomId }]);
    if (!error) { isJoined = true; fetchAll(); }
    isLoading = false;
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
      <input bind:value={playerName} placeholder="ชื่อเล่น" />
      <input bind:value={roomId} placeholder="รหัสห้อง" />
      <button class="btn join" onclick={joinGame}>เข้าห้อง</button>
    </div>
  {:else}
    <div class="game-layout">
      <header class="card">
        <div class="info">
          <h2>ห้อง: <span class="highlight">{roomId}</span></h2>
          <p class:active={isMyTurn}>{isMyTurn ? "🔥 ตาของคุณ!" : "รอเพื่อน..."}</p>
        </div>
        {#if isHost && !gameState?.is_started}
          <button class="btn start" onclick={startGame}>เริ่มเกม (แจก 3 ใบ)</button>
        {/if}
      </header>

      {#if gameState?.is_started}
        <div class="board card">
          <div class="pile">
            <span>กองจั่ว ({gameState.draw_pile.length})</span>
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

      <div class="players-grid">
        {#each players as p}
          <div class="player-card card" class:active-turn={gameState?.current_turn_id === p.id} class:is-me={p.name === playerName}>
            <div class="p-header">{p.name} {p.name === playerName ? `(แต้ม: ${myScore})` : ''}</div>
            <div class="hand">
              {#each (p.hand || [null, null, null]) as card, i}
                <button class="card-item" class:mine={p.name === playerName} class:can-swap={drawnCard && p.name === playerName} onclick={() => swap(i)}>
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
  .container { display: flex; justify-content: center; padding: 20px; }
  .card { background: #1e293b; border-radius: 15px; border: 1px solid #334155; padding: 20px; }
  .login-box { width: 300px; text-align: center; margin-top: 10vh; }
  input { width: 100%; padding: 10px; margin-bottom: 10px; background: #0f172a; border: 1px solid #334155; color: white; border-radius: 8px; box-sizing: border-box; }
  .game-layout { width: 100%; max-width: 800px; }
  header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .highlight { color: #38bdf8; }
  .active { color: #fbbf24; font-weight: bold; }
  .board { display: flex; justify-content: center; gap: 30px; margin-bottom: 20px; background: #111827; }
  .pile { display: flex; flex-direction: column; align-items: center; font-size: 0.8rem; color: #94a3b8; }
  .card-item { width: 60px; height: 90px; border-radius: 10px; border: 1px solid #334155; background: #0f172a; color: white; font-weight: bold; font-size: 1.2rem; cursor: pointer; display: flex; justify-content: center; align-items: center; }
  .deck { background: #334155; }
  .drawn { border-color: #fbbf24; color: #fbbf24; }
  .discard { background: white; color: black; }
  .players-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; }
  .player-card.active-turn { border-color: #fbbf24; }
  .player-card.is-me { border-color: #10b981; }
  .hand { display: flex; gap: 10px; justify-content: center; margin-top: 10px; }
  .mine { border-color: #10b981; }
  .can-swap { border: 2px dashed #fbbf24; animation: pulse 1s infinite; }
  .btn { padding: 10px 20px; border-radius: 8px; border: none; font-weight: bold; cursor: pointer; }
  .btn.join { width: 100%; background: #10b981; color: white; }
  .btn.start { background: #fbbf24; }
  @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
</style>