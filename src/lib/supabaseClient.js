import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

// ตรวจสอบค่าก่อนสร้าง Client เพื่อป้องกัน Error
if (!PUBLIC_SUPABASE_URL || !PUBLIC_SUPABASE_ANON_KEY) {
    console.error("⚠️ ตรวจพบข้อผิดพลาด: ไม่พบค่าในไฟล์ .env กรุณาตรวจสอบการตั้งค่า!");
}

export const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);