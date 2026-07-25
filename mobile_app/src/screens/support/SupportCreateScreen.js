import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import api from '../../services/api';
import ScreenHeader from '../../components/ScreenHeader';

export default function SupportCreateScreen({ navigation }) {
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ subject: '', description: '', category: null });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/support/categories/').then(r => setCategories(r.data.results || r.data)).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!form.subject.trim()) { Alert.alert('Error', 'Please enter a subject.'); return; }
    if (!form.description.trim()) { Alert.alert('Error', 'Please enter a description.'); return; }
    setSaving(true);
    try {
      await api.post('/app/tickets/', {
        subject:     form.subject,
        description: form.description,
        category:    form.category,
      });
      Alert.alert('Success', 'Your issue has been reported.', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (e) {
      Alert.alert('Error', e.response?.data?.detail || 'Could not submit the report.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
      <ScreenHeader title="Report a Problem" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        {/* Category */}
        <View>
          <Text style={styles.label}>Issue Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {categories.filter(c => c.is_active).map(c => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => setForm(f => ({ ...f, category: c.id }))}
                  style={[styles.catChip, form.category === c.id && styles.catChipActive]}
                >
                  <Text style={[styles.catText, form.category === c.id && styles.catTextActive]}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Subject */}
        <View>
          <Text style={styles.label}>Subject *</Text>
          <TextInput
            style={styles.input}
            value={form.subject}
            onChangeText={v => setForm(f => ({ ...f, subject: v }))}
            placeholder="Enter the subject briefly"
            maxLength={100}
          />
        </View>

        {/* Description */}
        <View>
          <Text style={styles.label}>Description *</Text>
          <TextInput
            style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]}
            value={form.description}
            onChangeText={v => setForm(f => ({ ...f, description: v }))}
            placeholder="Describe your issue in detail..."
            multiline
          />
        </View>

        {/* Hints */}
        <View style={styles.hintBox}>
          <Text style={styles.hintTitle}>Helpful tips</Text>
          <Text style={styles.hint}>• Mention when the problem started</Text>
          <Text style={styles.hint}>• Let us know if other devices are affected</Text>
          <Text style={styles.hint}>• Share a screenshot if there is an error</Text>
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, saving && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitText}>Submit Report</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBar: {
    backgroundColor: '#0f2d42', paddingHorizontal: 20, paddingVertical: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  back:        { color: '#93c5fd', fontSize: 14 },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  label:  { fontSize: 13, fontWeight: '600', color: '#374151' },
  catChip: {
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff',
  },
  catChipActive: { backgroundColor: '#173d59', borderColor: '#173d59' },
  catText:       { fontSize: 13, color: '#64748b', fontWeight: '500' },
  catTextActive: { color: '#fff', fontWeight: '600' },
  input: {
    borderWidth: 1.5, borderColor: '#e2e8f0',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: '#1e293b', backgroundColor: '#fff',
    marginTop: 8,
  },
  hintBox: {
    backgroundColor: '#eff6ff', borderRadius: 12,
    padding: 14, borderLeftWidth: 3, borderLeftColor: '#3b82f6',
  },
  hintTitle: { fontSize: 12, fontWeight: '700', color: '#1d4ed8', marginBottom: 6 },
  hint:      { fontSize: 12, color: '#3b82f6', marginBottom: 4 },
  submitBtn: {
    backgroundColor: '#173d59', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
