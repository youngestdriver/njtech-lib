<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import type { SeatMapDto, SeatDto } from "../api/types.js";

const props = defineProps<{ map: SeatMapDto }>();
const emit = defineEmits<{ (e: "click-seat", seat: SeatDto): void }>();

const CELL = 40, RADIUS = 14;
const COLOR_FREE = "#4CAF50", COLOR_OCCUPIED = "#F44336",
      COLOR_OTHER = "#9E9E9E", COLOR_BG = "#EEEEEE";

const canvasRef = ref<HTMLCanvasElement | null>(null);
const selectedKey = ref<string | null>(null);

const width = () => (props.map.maxX + 1) * CELL;
const height = () => (props.map.maxY + 1) * CELL;
const center = (s: SeatDto) => [ (s.x + 1) * CELL, (s.y + 1) * CELL ] as const;

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  canvas.width = width(); canvas.height = height();
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of props.map.seats) {
    const [cx, cy] = center(s);
    if (s.type === 1) {
      const color = s.seatStatus === 1 ? COLOR_FREE : s.seatStatus === 3 ? COLOR_OCCUPIED : COLOR_OTHER;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy, RADIUS, 0, Math.PI * 2); ctx.fill();
      if (selectedKey.value === s.key) {
        ctx.strokeStyle = "#FF9800"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, RADIUS + 4, 0, Math.PI * 2); ctx.stroke();
      }
      if (s.name) {
        ctx.fillStyle = "#FFFFFF"; ctx.font = "10px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(s.name, cx, cy);
      }
    } else {
      ctx.fillStyle = COLOR_BG;
      ctx.fillRect(cx - RADIUS, cy - RADIUS, RADIUS * 2, RADIUS * 2);
    }
  }
}

function onMouseDown(e: MouseEvent) {
  const canvas = e.target as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width > 0 ? canvas.width / rect.width : 1;  // CSS 缩放还原
  const px = e.offsetX * scale, py = e.offsetY * scale;
  const hit = props.map.seats.find(s => {
    const [cx, cy] = center(s);
    return Math.hypot(px - cx, py - cy) < RADIUS * 1.5;
  });
  if (hit && hit.type === 1 && hit.seatStatus === 1) {
    selectedKey.value = hit.key;
    emit("click-seat", hit);
    draw();
  }
}

onMounted(draw);
watch(() => props.map, draw);
watch(selectedKey, draw);
defineExpose({ selectedKey });
</script>

<template>
  <div class="seat-canvas" :style="{ maxWidth: '100%', overflow: 'auto' }">
    <canvas ref="canvasRef" @mousedown="onMouseDown"
            :style="{ display: 'block', maxWidth: '100%', height: 'auto' }" />
  </div>
</template>
