import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://xoowkjepvbokxmhsqmnm.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhvb3dramVwdmJva3htaHNxbW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NTI2NjUsImV4cCI6MjA5MjMyODY2NX0.2S_baIWot9ZkW7bsi16hy84O9Edf_XlBcQBmhXs3H1Y";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
