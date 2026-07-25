import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../services/api';
import ScreenHeader from '../../components/ScreenHeader';

// AI সহকারী — গ্রাহক প্রশ্ন লেখে, account-context সহ instant বাংলা উত্তর পায়।
// 🔒 শুধু non-sensitive data backend-এ যায়; local Ollama-তে উত্তর তৈরি হয়।
const WELCOME = 'আসসালামু আলাইকুম! আমি আপনার AI সহকারী। বিল, সংযোগ, গতি বা প্যাকেজ সংক্রান্ত যেকোনো প্রশ্ন করুন — আমি সাহায্য করার চেষ্টা করব।';

export default function AIChatScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState([{ from: 'bot', text: WELCOME }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestTicket, setSuggestTicket] = useState(false);
  const scrollRef = useRef(null);

  // অপেক্ষাকালীন rotating status — মেশিন ধীর হলেও ক্লায়েন্ট যেন বোঝে কাজ চলছে
  const LOADING_STEPS = [
    '🔍 আপনার তথ্য খুঁজছি…',
    '📋 অ্যাকাউন্ট ও রেকর্ড যাচাই করছি…',
    '✍️ সঠিক উত্তর তৈরি করছি…',
  ];
  const [loadStep, setLoadStep] = useState(0);
  useEffect(() => {
    if (!loading) { setLoadStep(0); return; }
    const id = setInterval(() => setLoadStep(s => (s + 1) % LOADING_STEPS.length), 2200);
    return () => clearInterval(id);
  }, [loading]);

  const scrollEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

  const send = async () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    setSuggestTicket(false);
    setMessages(m => [...m, { from: 'user', text: msg }]);
    scrollEnd();
    setLoading(true);
    try {
      // সাম্প্রতিক কথোপকথন (সর্বশেষ ৮টি) পাঠাই — LLM multi-turn context পায়
      const history = messages.slice(-8).map(x => ({ from: x.from, text: x.text }));
      const r = await api.post('/app/ai/chat/', { message: msg, history });
      const d = r.data || {};
      setMessages(m => [...m, {
        from: 'bot',
        text: d.reply || 'দুঃখিত, উত্তর তৈরি করা যায়নি।',
        ticketPk: d.ticket_pk || null,   // numeric pk → SupportDetail navigate
        ticketId: d.ticket_id || null,   // display নম্বর (TKT-...)
      }]);
      setSuggestTicket(!!d.suggest_ticket);
    } catch {
      setMessages(m => [...m, { from: 'bot', text: 'এই মুহূর্তে AI সহকারী পাওয়া যাচ্ছে না। অনুগ্রহ করে একটি টিকেট তৈরি করুন।' }]);
      setSuggestTicket(true);
    } finally { setLoading(false); scrollEnd(); }
  };

  return (
    // KAV-কে root করা হয়েছে (header-সহ) — edge-to-edge Android-এ window resize হয় না,
    // তাই behavior 'height'/'padding' দিয়ে keyboard খুললে input bar উপরে উঠে আসে।
    <KeyboardAvoidingView style={s.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}>
      <ScreenHeader title="AI সহকারী" subtitle="তাৎক্ষণিক সহায়তা" onBack={() => navigation.goBack()} />

      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled" onContentSizeChange={scrollEnd}>
          {messages.map((m, i) => (
            <View key={i} style={[s.row, m.from === 'user' ? s.rowUser : s.rowBot]}>
              {m.from === 'bot' && <Text style={s.botIcon}>🤖</Text>}
              <View style={s.msgCol}>
                <View style={[s.bubble, m.from === 'user' ? s.bubbleUser : s.bubbleBot]}>
                  <Text style={[s.btext, m.from === 'user' && { color: '#fff' }]}>{m.text}</Text>
                </View>
                {/* bot নিজে ticket তৈরি করলে — clickable chip → ticket বিস্তারিত পেজ */}
                {m.ticketPk ? (
                  <TouchableOpacity style={s.ticketChip} activeOpacity={0.8}
                    onPress={() => navigation.navigate('SupportDetail', { ticketId: m.ticketPk })}>
                    <Text style={s.ticketChipText}>🎫 টিকেট {m.ticketId} — বিস্তারিত দেখুন ›</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ))}

          {loading && (
            <View style={[s.row, s.rowBot]}>
              <Text style={s.botIcon}>🤖</Text>
              <View style={[s.bubble, s.bubbleBot, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                <ActivityIndicator size="small" color="#0f2d42" />
                <Text style={s.btext}>{LOADING_STEPS[loadStep]}</Text>
              </View>
            </View>
          )}

          {suggestTicket && !loading && (
            <TouchableOpacity style={s.ticketBtn} onPress={() => navigation.navigate('SupportCreate')}>
              <Text style={s.ticketText}>🎫 একটি টিকেট তৈরি করুন</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        <View style={[s.inputBar, { paddingBottom: 10 + insets.bottom }]}>
          <TextInput style={s.input} value={input} onChangeText={setInput}
            placeholder="আপনার প্রশ্ন লিখুন…" placeholderTextColor="#94a3b8"
            multiline onSubmitEditing={send} />
          <TouchableOpacity style={[s.sendBtn, (!input.trim() || loading) && { opacity: 0.5 }]}
            onPress={send} disabled={!input.trim() || loading}>
            <Text style={s.sendIcon}>➤</Text>
          </TouchableOpacity>
        </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#eef2f6' },
  list: { padding: 14, paddingBottom: 8 },
  row: { flexDirection: 'row', marginBottom: 10, alignItems: 'flex-end', gap: 6 },
  rowUser: { justifyContent: 'flex-end' },
  rowBot: { justifyContent: 'flex-start' },
  botIcon: { fontSize: 20, marginBottom: 2 },
  msgCol: { maxWidth: '80%' },
  bubble: { borderRadius: 16, paddingVertical: 10, paddingHorizontal: 13 },
  ticketChip: { marginTop: 6, alignSelf: 'flex-start', backgroundColor: '#eef2ff', borderColor: '#c7d2fe', borderWidth: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  ticketChipText: { color: '#4338ca', fontWeight: '800', fontSize: 12.5 },
  bubbleUser: { backgroundColor: '#173d59', borderBottomRightRadius: 4 },
  bubbleBot: { backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#e2e8f0' },
  btext: { fontSize: 14.5, lineHeight: 21, color: '#1f2937' },
  ticketBtn: { alignSelf: 'flex-start', marginLeft: 26, marginTop: 2, backgroundColor: '#fff7ed', borderColor: '#fed7aa', borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16 },
  ticketText: { color: '#ea580c', fontWeight: '800', fontSize: 13.5 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, gap: 8, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  input: { flex: 1, maxHeight: 110, backgroundColor: '#f1f5f9', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14.5, color: '#1f2937' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#173d59', alignItems: 'center', justifyContent: 'center' },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '900', marginLeft: 2 },
  note: { fontSize: 10, color: '#94a3b8', textAlign: 'center', paddingBottom: 6, backgroundColor: '#fff' },
});
