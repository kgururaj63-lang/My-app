import React, { useState, useEffect } from 'react';
import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  onAuthStateChanged, 
  User as FirebaseUser,
  signOut
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc,
  collection,
  addDoc,
  increment,
  onSnapshot,
  serverTimestamp 
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { getDocFromServer } from 'firebase/firestore';
import { UserProfile, transferData, getTransactionHistory, DataTransaction } from './lib/dataService';
import { NetworkNodes } from './components/NetworkNodes';
import { cn, formatData } from './lib/utils';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Activity, 
  ArrowRight, 
  ArrowDown,
  ArrowUp,
  History, 
  LogOut, 
  Plus, 
  Send, 
  Shield, 
  Smartphone, 
  Wifi, 
  Zap,
  QrCode,
  Share2,
  Copy,
  Check,
  Scan,
  Search,
  Bell,
  ShoppingBag,
  Home,
  HelpCircle,
  X
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'react-hot-toast';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<DataTransaction[]>([]);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [carrier, setCarrier] = useState<'Jio' | 'Airtel' | 'Vi' | 'BSNL' | 'Other'>('Jio');
  const [copied, setCopied] = useState(false);
  const [scannedPhone, setScannedPhone] = useState('');
  const [transferAmount, setTransferAmount] = useState('100');
  const [unit, setUnit] = useState<'KB' | 'MB' | 'GB'>('MB');
  const [activeTab, setActiveTab] = useState<'home' | 'search' | 'alerts' | 'history'>('home');
  const [showProfileDetail, setShowProfileDetail] = useState(false);
  const [recentPeers, setRecentPeers] = useState<{phone: string, carrier: string, name: string}[]>([]);

  useEffect(() => {
    let html5QrCode: Html5Qrcode | null = null;
    
    const startScanner = async () => {
      if (showScanner) {
        try {
          html5QrCode = new Html5Qrcode("reader");
          
          await html5QrCode.start(
            { facingMode: "environment" }, 
            {
              fps: 60,
              qrbox: { width: 250, height: 250 },
            },
            (decodedText) => {
              // Success callback
              handleScan(decodedText);
            },
            (errorMessage) => {
              // Failed to scan, usually silent
            }
          );
        } catch (err) {
          console.error("Unable to start scanning", err);
          toast.error("Camera access failed. Please ensure permissions are granted.");
          setShowScanner(false);
        }
      }
    };

    const handleScan = (decodedText: string) => {
      try {
        const url = new URL(decodedText);
        const ref = url.searchParams.get('ref');
        if (ref) {
          setScannedPhone(ref);
          stopAndClose();
          setShowTransfer(true);
          toast.success(`Identity identified: ${ref}`);
        } else {
          setScannedPhone(decodedText);
          stopAndClose();
          setShowTransfer(true);
          toast.success(`Identity identified: ${decodedText}`);
        }
      } catch (e) {
        setScannedPhone(decodedText);
        stopAndClose();
        setShowTransfer(true);
        toast.success(`Identity identified: ${decodedText}`);
      }
    };

    const stopAndClose = async () => {
      if (html5QrCode && html5QrCode.isScanning) {
        await html5QrCode.stop();
        await html5QrCode.clear();
      }
      setShowScanner(false);
    };

    startScanner();

    return () => {
      if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().then(() => {
          html5QrCode?.clear();
        }).catch(err => console.error("Failed to stop scanner", err));
      }
    };
  }, [showScanner]);

  useEffect(() => {
    // Check for ref in URL
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref && user && !isRegistering) {
      setShowTransfer(true);
      // We'll use a small delay to let the form render if needed, or just set it in a ref/state
      // But for now, we'll just open the modal. Pre-filling happens in the form render logic.
    }
  }, [user, isRegistering]);

  useEffect(() => {
    // Validate Connection to Firestore
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    let unsubProfile: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      // Clean up previous profile listener if any
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      setUser(u);
      
      if (u) {
        // Listen to profile changes
        const profileRef = doc(db, 'users', u.uid);
        unsubProfile = onSnapshot(profileRef, (snap) => {
          if (snap.exists()) {
            setProfile({ uid: snap.id, ...snap.data() } as UserProfile);
            setIsRegistering(false);
          } else {
            setProfile(null);
            setIsRegistering(true);
          }
          setLoading(false);
        }, (error) => {
          // If we are signed out, this error is expected and should be handled gracefully
          if (auth.currentUser) {
            handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
          }
        });

        // Load history
        try {
          const history = await getTransactionHistory();
          setTransactions(history);
          
          // Identify recent peers (unique recipients)
          const sentTo = history.filter(tx => tx.fromUid === u.uid);
          const peers = Array.from(new Set(sentTo.map(tx => tx.toPhone))).slice(0, 5).map(phone => {
            const tx = sentTo.find(t => t.toPhone === phone);
            return {
              phone,
              carrier: tx?.toCarrier || 'Mesh',
              name: phone.slice(-4) // Using last 4 as nickname placeholder
            };
          });
          setRecentPeers(peers);
        } catch (error) {
          console.error("Failed to load history", error);
        }
      } else {
        setProfile(null);
        setTransactions([]);
        setRecentPeers([]);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const handleTopUp = async (amountMB: number) => {
    if (!user || !profile) return;
    const topUpToast = toast.loading(`Processing payment for ${formatData(amountMB)}...`);
    
    try {
      // In a real app, this is where Stripe/Razorpay logic would go
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        balanceMB: increment(amountMB),
        lastActive: serverTimestamp()
      });
      
      // Log the purchase
      await addDoc(collection(db, 'transactions'), {
        fromUid: 'SYSTEM_STORE',
        toUid: user.uid,
        fromPhone: 'DataLink Store',
        toPhone: profile.phoneNumber,
        fromCarrier: 'DATA_MESH',
        toCarrier: profile.carrier,
        amountMB: amountMB,
        status: 'completed',
        type: 'purchase',
        timestamp: serverTimestamp()
      });

      toast.success(`Purchased ${formatData(amountMB)} successfully!`, { id: topUpToast });
      setShowStore(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      toast.error("Payment failed. Please try again.", { id: topUpToast });
    }
  };

  const handleLogin = async () => {
    const toastId = toast.loading('Connecting to Mesh...');
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      toast.success('Connected successfully!', { id: toastId });
    } catch (error: any) {
      console.error('Login Error:', error);
      let message = error.message;
      if (error.code === 'auth/operation-not-allowed') {
        message = 'Google Auth is not enabled in Firebase Console. Please enable it in the Authentication tab.';
      } else if (error.code === 'auth/popup-blocked') {
        message = 'Login popup was blocked. Please allow popups for this site.';
      }
      toast.error('Login failed: ' + message, { id: toastId });
    }
  };

  const handleSignOut = () => signOut(auth);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !phoneNumber) return;

    try {
      const profileRef = doc(db, 'users', user.uid);
      const newProfile = {
        uid: user.uid,
        phoneNumber,
        displayName: user.displayName || 'Anon Peer',
        balanceMB: 1024, 
        carrier,
        lastActive: serverTimestamp()
      };
      
      await setDoc(profileRef, newProfile);
      await setDoc(doc(db, 'phoneToUid', phoneNumber), { uid: user.uid });
      
      toast.success('Joined DataLink P2P Network!');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  const handleTransfer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const targetPhone = formData.get('phone') as string;
    const numericAmount = parseFloat(transferAmount);

    if (!targetPhone || targetPhone.length < 10 || isNaN(numericAmount) || numericAmount <= 0) {
      toast.error('Please enter a valid phone and amount');
      return;
    }

    // Convert to MB for backend
    const amountInMB = unit === 'GB' ? numericAmount * 1024 : 
                       unit === 'KB' ? numericAmount / 1024 : 
                       numericAmount;

    if (amountInMB > (profile?.balanceMB || 0)) {
      toast.error('Insufficient data balance');
      return;
    }

    const toastId = toast.loading('Initiating Carrier Mesh Transfer...');
    try {
      await transferData(targetPhone, amountInMB);
      toast.success(`Successfully transmitted ${formatData(numericAmount)} ${unit}`, { id: toastId });
      setShowTransfer(false);
      setScannedPhone('');
      setTransferAmount('100');
      const history = await getTransactionHistory();
      setTransactions(history);
    } catch (error: any) {
      toast.error(error.message, { id: toastId });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Activity className="animate-spin text-accent-light" size={40} />
      </div>
    );
  }

  return (
    <div className="min-h-screen tech-grid relative overflow-hidden selection:bg-accent-light selection:text-white">
      <NetworkNodes />
      <Toaster 
        position="top-center" 
        toastOptions={{ 
          style: { 
            background: 'rgba(255, 255, 255, 0.9)', 
            backdropFilter: 'blur(10px)',
            color: '#1A1D23', 
            border: '1px solid rgba(6, 108, 244, 0.1)',
            borderRadius: '1rem',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
          } 
        }} 
      />
      
      <header className="relative z-10 px-6 py-4 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowProfileDetail(true)}
            className="w-10 h-10 glass-card rounded-xl flex items-center justify-center text-accent shadow-lg bg-white/80 active:scale-95 transition-all outline-none"
          >
            <span className="font-bold text-accent">{profile?.displayName?.charAt(0).toUpperCase() || 'U'}</span>
            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-accent rounded-full flex items-center justify-center text-[8px] text-white border-2 border-white">
              <QrCode size={8} />
            </div>
          </button>
          <div className="flex flex-col -space-y-1">
            <span className="text-[10px] font-black tracking-[0.2em] text-accent opacity-60 uppercase">Node</span>
            <span className="text-sm font-black text-ink uppercase tracking-tighter">DATA <span className="text-accent">SHARE</span></span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button className="p-2 text-ink/60 hover:text-accent transition-colors">
            <HelpCircle size={24} />
          </button>
          {user && (
            <button 
              onClick={handleSignOut}
              className="px-4 py-2 glass-card rounded-full text-[10px] font-mono hover:bg-black/5 transition-colors uppercase tracking-widest text-ink/60 border-white/50"
            >
              Sign Out
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 pt-12 pb-24">
        {user && profile ? (
          <div className="space-y-8 pb-32">
            {/* Hero Banner Section */}
            {activeTab === 'home' && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <div className="text-center space-y-4 mb-2">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  >
                    <p className="inline-block text-[10px] font-mono uppercase tracking-[0.4em] text-accent font-black bg-accent/5 px-4 py-1.5 rounded-full border border-accent/10">
                      Decentralized Mesh Protocol
                    </p>
                  </motion.div>
                  
                  <div className="relative">
                    <motion.h2 
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                      className="text-4xl sm:text-5xl font-black tracking-tighter leading-tight text-transparent bg-clip-text bg-gradient-to-br from-accent via-accent-light to-accent pb-4"
                    >
                      Transfer data without <br/> 
                      <span className="relative">
                        internet or wires
                        <motion.span 
                          initial={{ width: 0 }}
                          animate={{ width: '100%' }}
                          transition={{ delay: 1, duration: 1, ease: "easeInOut" }}
                          className="absolute -bottom-1 left-0 h-1 bg-accent/30 rounded-full"
                        />
                      </span>
                    </motion.h2>
                    
                    {/* Subtle glow effect behind text */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-24 bg-accent/5 blur-[80px] -z-10 rounded-full" />
                  </div>
                </div>

                <div className="relative glass-card bg-white p-8 rounded-[3rem] overflow-hidden group border-white text-ink shadow-[0_32px_64px_-12px_rgba(6,108,244,0.12)] flex flex-col items-center justify-center min-h-[260px]">
                  <div className="relative z-10 flex flex-col items-center gap-6 py-6 text-center">
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-accent tracking-[0.4em] uppercase">Mesh Credit Balance</p>
                      <div className="h-1 w-12 bg-accent/20 rounded-full mx-auto" />
                    </div>
                    <div className="text-8xl font-black tracking-tighter flex items-baseline gap-2 text-accent drop-shadow-sm">
                      {profile?.balanceMB ? (profile.balanceMB / 1024).toFixed(2) : '1.00'}
                      <span className="text-3xl font-bold opacity-30 text-accent">GB</span>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2 bg-accent/5 rounded-2xl border border-accent/10">
                       <Shield size={12} className="text-accent" />
                       <p className="text-[9px] font-bold uppercase text-accent tracking-widest">End-to-End Encrypted Node</p>
                    </div>
                  </div>
                  
                  {/* Decorative mesh bg */}
                  <div className="absolute inset-0 opacity-[0.03] pointer-events-none scale-150">
                     <MeshGraphic />
                  </div>
                  <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 blur-[100px] rounded-full -mr-20 -mt-20" />
                </div>

                {/* Quick Action Grid & Recent Peers */}
                <section className="space-y-6 pt-4">
                  <div className="flex justify-between items-center px-1">
                    <div className="flex flex-col">
                      <h3 className="font-bold text-lg text-accent leading-tight">DATA Transfers</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                         <span className="text-[9px] font-black uppercase text-emerald-500">Live</span>
                         <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                      </div>
                    </div>
                    <div className="px-3 py-1 bg-amber-100/50 text-amber-700 text-[10px] font-bold rounded-full border border-amber-200/50 animate-pulse">
                      Refer → Get 200MB
                    </div>
                  </div>


                  <div className="grid grid-cols-3 gap-3">
                    <button 
                      onClick={() => setShowTransfer(true)}
                      className="flex flex-col items-center gap-4 p-5 rounded-[2.5rem] bg-accent text-white shadow-2xl shadow-accent/20 hover:scale-105 active:scale-95 transition-all group"
                    >
                       <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center">
                          <Send size={24} />
                       </div>
                       <span className="text-[10px] font-black uppercase tracking-tight">Send</span>
                    </button>
                    <button 
                      onClick={() => setShowQr(true)}
                      className="flex flex-col items-center gap-4 p-5 rounded-[2.5rem] bg-white border border-black/5 shadow-xl shadow-black/5 hover:scale-105 active:scale-95 transition-all text-ink"
                    >
                       <div className="w-12 h-12 rounded-2xl bg-black/5 flex items-center justify-center">
                          <QrCode size={24} />
                       </div>
                       <span className="text-[10px] font-black uppercase tracking-tight">My ID</span>
                    </button>
                    <button 
                      onClick={() => setShowScanner(true)}
                      className="flex flex-col items-center gap-4 p-5 rounded-[2.5rem] bg-white border border-black/5 shadow-xl shadow-black/5 hover:scale-105 active:scale-95 transition-all text-ink"
                    >
                       <div className="w-12 h-12 rounded-2xl bg-black/5 flex items-center justify-center">
                          <Scan size={24} />
                       </div>
                       <span className="text-[10px] font-black uppercase tracking-tight">Scanner</span>
                    </button>
                  </div>

                  {/* Integrated Recent Peers / Shortcuts */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center px-1">
                       <span className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/20">Quick Select</span>
                       <button onClick={() => setActiveTab('history')} className="text-[10px] font-bold text-accent">HISTORY</button>
                    </div>
                    
                    <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                      {(recentPeers.length > 0 ? recentPeers : [
                         { phone: '9999900001', carrier: 'Jio', name: 'Demo1' },
                         { phone: '9999900002', carrier: 'Airtel', name: 'Demo2' }
                      ]).map((peer, idx) => (
                        <motion.button 
                          key={idx}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => {
                            setScannedPhone(peer.phone);
                            setShowTransfer(true);
                          }}
                          className="flex flex-col items-center gap-2 shrink-0 group"
                        >
                          <div className={cn(
                            "w-14 h-14 rounded-2xl flex items-center justify-center text-accent font-black text-xl transition-all relative border border-transparent shadow-sm",
                            recentPeers.length > 0 ? "bg-accent/5 border-accent/10" : "bg-black/5 opacity-40"
                          )}>
                            {peer.phone.slice(-1)}
                            <Zap size={10} className="absolute -bottom-1 -right-1 text-accent fill-accent" />
                          </div>
                          <span className="text-[9px] font-bold text-ink/60 leading-none">...{peer.phone.slice(-4)}</span>
                        </motion.button>
                      ))}
                    </div>
                  </div>

                  {/* Transfer Visual Shortcut on Home */}
                  {transactions.length > 0 && (
                    <div className="glass-card bg-emerald-500/5 border-emerald-500/10 p-4 rounded-[2rem] flex items-center justify-between">
                       <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-200">
                             <Check size={18} />
                          </div>
                          <div className="flex flex-col">
                             <span className="text-[8px] font-black text-emerald-600/50 uppercase tracking-[0.1em]">Last Transmission</span>
                             <span className="text-[10px] font-bold text-ink">To ...{transactions[0].toPhone.slice(-4)}</span>
                          </div>
                       </div>
                       <div className="flex flex-col items-end">
                          <span className="text-sm font-black text-emerald-600">{formatData(transactions[0].amountMB)}</span>
                          <button 
                            onClick={() => {
                              setScannedPhone(transactions[0].toPhone);
                              setShowTransfer(true);
                            }}
                            className="text-[9px] font-black text-accent mt-1 flex items-center gap-1"
                          >
                             REPEAT <ArrowRight size={10} />
                          </button>
                       </div>
                    </div>
                  )}
                </section>


                <div className="grid grid-cols-2 gap-4">
                   <button 
                     onClick={() => setShowStore(true)}
                     className="glass-card p-4 rounded-2xl bg-white focus:ring-2 ring-accent flex items-center gap-3 border-white/50 text-left hover:scale-105 transition-all shadow-sm"
                   >
                      <div className="p-2 bg-indigo-50 rounded-lg text-indigo-500">
                         <ShoppingBag size={20} />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-ink uppercase tracking-tight">Data Store</span>
                        <span className="text-[8px] font-bold text-accent">TOP-UP NOW</span>
                      </div>
                   </button>
                   <div className="glass-card p-4 rounded-2xl bg-white flex items-center gap-3 border-white/50 shadow-sm opacity-60">
                      <div className="p-2 bg-emerald-50 rounded-lg text-emerald-500">
                         <Shield size={20} />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-ink uppercase tracking-tight">Secure Mesh</span>
                        <span className="text-[8px] font-bold text-emerald-600">VERIFIED</span>
                      </div>
                   </div>
                </div>

                {/* Recharge & Bills Section */}
                <section className="space-y-4 pt-4">
                  <h3 className="font-bold text-lg text-ink">Recharge & Bills</h3>
                  <div className="grid grid-cols-4 gap-4">
                    {[
                      { icon: <Smartphone className="text-blue-500" />, label: 'Mobile Recharge' },
                      { icon: <Activity className="text-emerald-500" />, label: 'Fastag' },
                      { icon: <Zap className="text-amber-500" />, label: 'Electricity' },
                      { icon: <Plus className="text-slate-400" />, label: 'More' }
                    ].map((item, idx) => (
                      <div key={idx} className="flex flex-col items-center gap-2">
                        <div className="w-14 h-14 rounded-2xl bg-white/60 border border-black/5 flex items-center justify-center shadow-sm">
                          {item.icon}
                        </div>
                        <span className="text-[9px] text-center font-medium text-ink/40 leading-tight">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </motion.div>
            )}

            {/* Search Tab Placeholder */}
            {activeTab === 'search' && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6 text-center py-20"
              >
                <div className="w-20 h-20 bg-accent/10 rounded-full flex items-center justify-center mx-auto text-accent mb-4">
                  <Search size={40} />
                </div>
                <h3 className="text-2xl font-bold text-ink">Search the Mesh</h3>
                <p className="text-ink/40 max-w-xs mx-auto">Find global nodes, carriers, or peer-shared credit pools.</p>
                <div className="pt-8">
                  <input 
                    type="text" 
                    placeholder="Search phone, name, or node ID..."
                    className="w-full max-w-md glass-card py-4 px-6 rounded-2xl outline-none focus:border-accent transition-all text-ink border-black/5"
                  />
                </div>
              </motion.div>
            )}

            {/* Alerts Tab Placeholder */}
            {activeTab === 'alerts' && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <h3 className="text-2xl font-bold text-ink px-2">Network Alerts</h3>
                <div className="space-y-4">
                  {[
                    { title: 'Reward Received', desc: 'You got 100MB for your 5th transfer!', time: '2h ago', icon: <Zap className="text-amber-500" /> },
                    { title: 'Security Patch', desc: 'Mesh nodes in your area updated to v2.4', time: '1d ago', icon: <Shield className="text-blue-500" /> }
                  ].map((alert, i) => (
                    <div key={i} className="glass-card p-6 rounded-3xl flex gap-4 items-start border-black/5">
                      <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shrink-0 shadow-sm">
                        {alert.icon}
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <h4 className="font-bold text-ink">{alert.title}</h4>
                          <span className="text-[10px] font-mono opacity-30 uppercase">{alert.time}</span>
                        </div>
                        <p className="text-sm text-ink/50 leading-relaxed">{alert.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Logs / History View */}
            {activeTab === 'history' && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-2xl font-bold italic text-ink">Transmission Logs</h3>
                  <span className="text-[10px] font-mono opacity-30 uppercase tracking-widest text-ink">Global Sector 429</span>
                </div>
                
                <div className="grid grid-cols-1 gap-4">
                  {transactions.length === 0 ? (
                    <div className="glass-card p-20 rounded-[2.5rem] text-center text-ink/20">
                      <Activity className="mx-auto mb-4 opacity-20" size={40} />
                      <p>No activity detected in the local mesh network.</p>
                    </div>
                  ) : (
                    transactions.map((tx) => (
                      <motion.div 
                        key={tx.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="glass-card p-6 rounded-3xl flex items-center justify-between group hover:bg-white/60 transition-all border-white/60"
                      >
                        <div className="flex items-center gap-5">
                          <div className={cn(
                            "w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0",
                            tx.fromUid === user?.uid 
                              ? "bg-red-400/10 border-red-400/20 text-red-500" 
                              : "bg-emerald-400/10 border-emerald-400/20 text-emerald-600"
                          )}>
                            {tx.fromUid === user?.uid ? <Send size={20} /> : <Plus size={20} />}
                          </div>
                          <div className="overflow-hidden">
                            <div className="flex flex-col">
                               <div className="flex items-center gap-2 overflow-hidden">
                                  <span className="text-[8px] font-black uppercase text-accent/50 shrink-0">From</span>
                                  <p className="font-mono text-[10px] text-ink/60 truncate">{tx.fromPhone || 'System'}</p>
                               </div>
                               <div className="flex items-center gap-2 overflow-hidden">
                                  <span className="text-[8px] font-black uppercase text-accent shrink-0">To</span>
                                  <p className="font-bold text-lg text-ink truncate">{tx.toPhone}</p>
                                  <span className="text-[8px] font-mono opacity-40 uppercase bg-black/5 px-1.5 py-0.5 rounded shrink-0">
                                    {tx.toCarrier || 'MESH'}
                                  </span>
                               </div>
                            </div>
                            <div className="flex items-center gap-3 mt-1">
                              <p className="text-[10px] text-ink/40 font-mono">
                                {new Date(tx.timestamp?.toMillis()).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                              {tx.fromUid === user?.uid && (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setScannedPhone(tx.toPhone);
                                    setShowTransfer(true);
                                  }}
                                  className="text-[9px] font-black text-accent flex items-center gap-1 hover:underline bg-accent/5 px-2 py-0.5 rounded-full"
                                >
                                  <Zap size={8} fill="currentColor" /> SEND AGAIN
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={cn(
                            "text-2xl font-mono font-bold tracking-tighter",
                            tx.fromUid === user?.uid ? "text-ink" : "text-emerald-600"
                          )}>
                            {tx.fromUid === user?.uid ? '-' : '+'}{formatData(tx.amountMB)}
                          </p>
                          <div className="flex items-center justify-end gap-1 opacity-40">
                            <Shield size={10} className="text-ink" />
                            <span className="text-[10px] uppercase tracking-widest text-ink font-bold">VERIFIED</span>
                          </div>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              </motion.div>
            )}
          </div>
        ) : isRegistering ? (
          <section className="max-w-xl mx-auto space-y-12 py-12">
            <div className="space-y-4 text-center">
              <h2 className="text-5xl font-bold tracking-tight italic text-ink">Initialize Identity.</h2>
              <p className="text-ink/40 text-lg">Cross-network peer discovery requires phone registration.</p>
            </div>
            
            <form onSubmit={handleRegister} className="glass-card p-10 rounded-[2.5rem] space-y-8 shadow-2xl border-white/50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-mono tracking-widest opacity-40 px-2 text-ink">Phone Number</label>
                  <input 
                    type="tel" 
                    placeholder="+91..."
                    required
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full bg-white/40 border border-black/5 rounded-2xl py-4 px-6 focus:border-accent outline-none transition-all focus:bg-white/80 text-ink"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-mono tracking-widest opacity-40 px-2 text-ink">Active Carrier</label>
                  <select 
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value as any)}
                    className="w-full bg-white/40 border border-black/5 rounded-2xl py-4 px-6 focus:border-accent outline-none transition-all appearance-none focus:bg-white/80 text-ink"
                  >
                    <option value="Jio" className="bg-white">Jio</option>
                    <option value="Airtel" className="bg-white">Airtel</option>
                    <option value="Vi" className="bg-white">Vi</option>
                    <option value="BSNL" className="bg-white">BSNL</option>
                    <option value="Other" className="bg-white">Other</option>
                  </select>
                </div>
              </div>
              <button 
                type="submit"
                className="w-full py-5 bg-accent text-white font-bold rounded-2xl hover:bg-accent/90 active:scale-[0.98] transition-all shadow-lg shadow-accent/10"
              >
                JOIN THE MESH
              </button>
            </form>
          </section>
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4">
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="max-w-2xl w-full glass-card rounded-[3rem] p-12 space-y-10 relative overflow-hidden shadow-2xl border-white/40"
            >
              <div className="space-y-3 relative z-10">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.1 }}
                >
                  <p className="text-[10px] font-black uppercase tracking-[0.5em] text-accent opacity-60">P2P Network Engine</p>
                  <h1 className="text-6xl md:text-7xl font-black text-ink tracking-tighter leading-none mt-2">
                    DATA <span className="text-accent underline decoration-8 underline-offset-8">SHARE</span>
                  </h1>
                </motion.div>
              </div>

              {/* Animated Data Arrows */}
              <motion.div 
                className="relative w-40 h-40 bg-accent/5 rounded-full flex items-center justify-center mx-auto"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                <div className="absolute inset-0 bg-accent/10 rounded-full animate-ping opacity-20" />
                <div className="relative flex gap-2">
                  <motion.div
                    animate={{ y: [-15, 15, -15] }}
                    transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
                    className="flex flex-col items-center"
                  >
                    <ArrowDown size={56} className="text-accent" strokeWidth={3} />
                    <span className="text-[8px] font-black text-accent mt-1 tracking-widest">DRIVE</span>
                  </motion.div>
                  <motion.div
                    animate={{ y: [15, -15, 15] }}
                    transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
                    className="flex flex-col items-center"
                  >
                    <ArrowUp size={56} className="text-accent" strokeWidth={3} />
                    <span className="text-[8px] font-black text-accent mt-1 tracking-widest">CLOUD</span>
                  </motion.div>
                </div>
              </motion.div>

              <div className="space-y-6 relative z-10">
                <p className="text-ink/60 text-lg max-w-sm mx-auto font-medium leading-relaxed">
                  Join the decentralized bandwidth mesh and transfer digital credits instantly across global carriers.
                </p>
                <div className="pt-4">
                  <button 
                    onClick={handleLogin}
                    className="group relative w-full max-w-xs mx-auto py-5 bg-accent text-white font-black text-sm tracking-widest rounded-3xl shadow-[0_20px_40px_-10px_rgba(6,108,244,0.4)] hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-4 overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-white/10 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out" />
                    START SHARING <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>

              {/* Decorative Blur BG in Card */}
              <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-accent/5 blur-[80px] rounded-full" />
              <div className="absolute -top-20 -left-20 w-64 h-64 bg-accent/5 blur-[80px] rounded-full" />
            </motion.div>

            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-12 flex items-center gap-6 opacity-40 grayscale hover:grayscale-0 transition-all cursor-default"
            >
              <div className="flex -space-x-2">
                {[1,2,3,4].map(i => (
                  <div key={i} className="w-8 h-8 rounded-full border-2 border-slate-900 bg-slate-800 flex items-center justify-center text-[10px] font-black text-white">
                     {String.fromCharCode(64 + i)}
                  </div>
                ))}
              </div>
              <p className="text-[9px] font-black uppercase tracking-[0.3em] text-ink">
                Over <span className="text-accent">12.4k</span> Nodes Optimized
              </p>
            </motion.div>
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      {user && profile && (
        <div className="fixed bottom-0 inset-x-0 z-[60] bg-white/90 backdrop-blur-2xl border-t border-black/5 pb-8 pt-3 px-6 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <button 
              onClick={() => setActiveTab('home')}
              className={cn(
                "flex flex-col items-center gap-1 transition-all",
                activeTab === 'home' ? "text-accent" : "text-ink/30 hover:text-ink/60"
              )}
            >
              <Home size={22} />
              <span className="text-[9px] font-bold uppercase tracking-widest">Home</span>
            </button>
            <button 
              onClick={() => setActiveTab('search')}
              className={cn(
                "flex flex-col items-center gap-1 transition-all",
                activeTab === 'search' ? "text-accent" : "text-ink/30 hover:text-ink/60"
              )}
            >
              <Search size={22} />
              <span className="text-[9px] font-bold uppercase tracking-widest">Search</span>
            </button>
            
            <div className="relative -mt-12 px-2">
              <button 
                onClick={() => setShowScanner(true)}
                className="w-16 h-16 rounded-full bg-accent text-white flex items-center justify-center shadow-2xl shadow-indigo-200 active:scale-90 transition-all border-4 border-[#F8FAFC]"
              >
                <Scan size={32} />
              </button>
            </div>

            <button 
              onClick={() => setActiveTab('alerts')}
              className={cn(
                "flex flex-col items-center gap-1 transition-all",
                activeTab === 'alerts' ? "text-accent" : "text-ink/30 hover:text-ink/60"
              )}
            >
              <div className="relative">
                <Bell size={22} />
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-[8px] text-white rounded-full flex items-center justify-center border-2 border-white">2</div>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-widest">Alerts</span>
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={cn(
                "flex flex-col items-center gap-1 transition-all",
                activeTab === 'history' ? "text-accent" : "text-ink/30 hover:text-ink/60"
              )}
            >
              <History size={22} />
              <span className="text-[9px] font-bold uppercase tracking-widest">History</span>
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showProfileDetail && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowProfileDetail(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative z-10 w-full max-w-xs glass-card rounded-3xl p-8 shadow-2xl border-white bg-white/90 flex flex-col items-center text-center space-y-6"
            >
               <div className="absolute top-4 right-4 focus:outline-none">
                <button 
                  onClick={() => setShowProfileDetail(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-ink/20 hover:text-ink transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="w-20 h-20 bg-accent rounded-2xl flex items-center justify-center text-white text-3xl font-bold shadow-xl shadow-accent/20">
                {profile?.displayName?.charAt(0).toUpperCase()}
              </div>

              <div className="space-y-1">
                <h3 className="text-2xl font-bold text-ink">{profile?.displayName}</h3>
                <p className="text-accent font-mono text-sm tracking-tight">{profile?.phoneNumber}</p>
                <div className="pt-2">
                  <span className="px-3 py-1 bg-accent/10 rounded-full text-[10px] font-bold text-accent uppercase tracking-wider">
                    {profile?.carrier} Network
                  </span>
                </div>
              </div>

              <div className="w-full pt-4 border-t border-black/5">
                 <button 
                  onClick={handleSignOut}
                  className="w-full py-3 rounded-xl border border-red-100 text-red-500 text-xs font-bold hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
                >
                  <LogOut size={14} /> SIGN OUT
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Transfer Glass Modal */}
      <AnimatePresence>
        {showTransfer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTransfer(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative z-10 w-full max-w-lg glass-card rounded-[3rem] p-10 shadow-2xl border-white/80"
            >
              <div className="flex justify-between items-start mb-10">
                <div className="space-y-1">
                  <h2 className="text-3xl font-bold tracking-tight italic text-ink">Initiate Sharing</h2>
                  <p className="text-ink/40 text-sm">Credits are transferred instantly peer-to-peer.</p>
                </div>
                <button 
                  onClick={() => setShowTransfer(false)}
                  className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-md border border-black/5 text-ink/40 hover:text-ink transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleTransfer} className="space-y-8">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center px-2">
                       <label className="text-[10px] uppercase font-mono opacity-30 tracking-[0.2em] text-ink">Recipient Node</label>
                       <button 
                         type="button"
                         onClick={() => {
                           setShowTransfer(false);
                           setShowScanner(true);
                         }}
                         className="flex items-center gap-2 text-[9px] font-black text-accent uppercase tracking-wider bg-accent/5 px-3 py-1 rounded-full border border-accent/20"
                       >
                         <Scan size={12} /> Scan QR
                       </button>
                    </div>
                    <div className="relative">
                      <div className="absolute left-6 top-1/2 -translate-y-1/2 flex items-center gap-2">
                         {scannedPhone ? <Scan className="text-accent" size={20} /> : <Smartphone className="text-ink/20" size={20} />}
                      </div>
                      <input 
                        name="phone"
                        type="tel" 
                        placeholder="+91..."
                        required
                        defaultValue={scannedPhone || new URLSearchParams(window.location.search).get('ref') || ''}
                        key={scannedPhone || 'phone-input'}
                        className={cn(
                          "w-full bg-white/40 border rounded-2xl py-5 pl-16 pr-6 focus:border-accent outline-none transition-all text-ink",
                          scannedPhone ? "border-accent/40 ring-4 ring-accent/5" : "border-black/5"
                        )}
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-mono opacity-30 tracking-[0.2em] px-2 text-ink">Data Credit Amount</label>
                    <div className="relative">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 flex gap-1 z-10">
                        {(['KB', 'MB', 'GB'] as const).map((u) => (
                          <button
                            key={u}
                            type="button"
                            onClick={() => setUnit(u)}
                            className={cn(
                              "px-2 py-1 rounded-lg text-[9px] font-black transition-all",
                              unit === u ? "bg-accent text-white shadow-sm" : "bg-black/5 text-ink/40 hover:bg-black/10"
                            )}
                          >
                            {u}
                          </button>
                        ))}
                      </div>
                      <input 
                        name="amount"
                        type="number" 
                        step="any"
                        min="0.01"
                        placeholder="100.00"
                        required
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                        className="w-full bg-white/40 border border-black/5 rounded-2xl py-5 pl-28 pr-6 focus:border-accent outline-none transition-all text-ink font-bold"
                      />
                    </div>
                    <p className="text-[10px] text-ink/30 px-3 flex justify-between">
                      <span>Network Max: {formatData(profile?.balanceMB || 0)}</span>
                      <span className="text-accent font-bold">NO FEES</span>
                    </p>
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full py-5 bg-accent text-white font-bold rounded-2xl hover:scale-[1.02] transition-all shadow-xl shadow-accent/20 flex items-center justify-center gap-3"
                >
                  EXECUTE TRANSFER <Send size={20} />
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showQr && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowQr(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative z-10 w-full max-w-md glass-card rounded-[3rem] p-10 shadow-2xl border-white/80 flex flex-col items-center text-center space-y-8"
            >
              <div className="absolute top-6 right-6">
                <button 
                  onClick={() => setShowQr(false)}
                  className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-md border border-black/5 text-ink/40 hover:text-ink transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-1">
                <h2 className="text-3xl font-bold tracking-tight italic text-ink">Share Identity</h2>
                <p className="text-ink/40 text-sm">Let peers connect to your node instantly.</p>
              </div>

              <div className="p-6 bg-white rounded-3xl shadow-inner border border-black/5">
                <QRCodeSVG 
                  value={`${window.location.origin}?ref=${profile?.phoneNumber}`}
                  size={200}
                  level="H"
                  includeMargin={true}
                />
              </div>

              <div className="w-full space-y-4">
                <div className="glass-card p-4 rounded-2xl flex items-center justify-between gap-4 border-black/5">
                  <span className="text-xs font-mono opacity-50 truncate text-ink">
                    {window.location.origin}?ref={profile?.phoneNumber}
                  </span>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}?ref=${profile?.phoneNumber}`);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                      toast.success('Link copied to clipboard');
                    }}
                    className="p-2 hover:bg-black/5 rounded-xl transition-colors shrink-0 text-ink"
                  >
                    {copied ? <Check size={18} className="text-emerald-500" /> : <Copy size={18} />}
                  </button>
                </div>

                <button 
                  onClick={() => {
                    if (navigator.share) {
                      navigator.share({
                        title: 'Connect with me on DataLink',
                        text: `Use my link to send me data credits on the mesh network!`,
                        url: `${window.location.origin}?ref=${profile?.phoneNumber}`
                      });
                    } else {
                      toast.error('Sharing not supported on this browser');
                    }
                  }}
                  className="w-full py-5 bg-accent text-white font-bold rounded-2xl hover:scale-[1.02] transition-all flex items-center justify-center gap-3 shadow-lg shadow-accent/20"
                >
                  <Share2 size={20} /> SHARE LINK
                </button>
              </div>

              <button 
                onClick={() => setShowQr(false)}
                className="text-ink/20 hover:text-ink/40 transition-colors text-xs font-mono uppercase tracking-widest"
              >
                Close Modal
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Data Store Modal */}
      <AnimatePresence>
        {showStore && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowStore(false)}
              className="absolute inset-0 bg-ink/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="relative w-full max-w-lg bg-[#F8F9FA] rounded-t-[3rem] sm:rounded-[3rem] overflow-hidden shadow-2xl p-8"
            >
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h2 className="text-3xl font-black text-ink tracking-tight">Data Store</h2>
                  <p className="text-sm text-ink/40 font-medium">Recharge your mesh credits</p>
                </div>
                <button 
                  onClick={() => setShowStore(false)}
                  className="p-2 hover:bg-black/5 rounded-full"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 mb-8">
                {[
                  { mb: 1024, price: 15, label: "1GB Starter" },
                  { mb: 2048, price: 25, label: "2GB Standard", popular: true },
                  { mb: 5120, price: 50, label: "5GB Pro" },
                ].map((plan) => (
                  <button
                    key={plan.mb}
                    onClick={() => handleTopUp(plan.mb)}
                    className={cn(
                      "group p-5 rounded-[2rem] border-2 flex items-center justify-between transition-all outline-none",
                      plan.popular ? "bg-accent border-accent text-white shadow-xl shadow-accent/20" : "bg-white border-black/5 hover:border-accent"
                    )}
                  >
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-xl">{plan.label}</span>
                        {plan.popular && <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-bold">POPULAR</span>}
                      </div>
                      <p className={cn("text-sm font-medium", plan.popular ? "text-white/60" : "text-ink/30")}>
                        Instantly added to your node
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-black">₹{plan.price}</span>
                      <div className={cn("p-2 rounded-xl", plan.popular ? "bg-white text-accent" : "bg-accent/10 text-accent")}>
                        <ArrowRight size={20} />
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="bg-white/40 p-4 rounded-3xl border border-black/5 flex items-center gap-4">
                 <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
                    <Shield size={20} />
                 </div>
                 <p className="text-[10px] font-bold text-ink/40 leading-relaxed uppercase tracking-wider">
                   All purchases are encrypted and verified on the mesh network.
                 </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showScanner && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowScanner(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative z-10 w-full max-w-lg glass-card rounded-[3rem] p-10 shadow-2xl border-white/80 flex flex-col items-center text-center space-y-8"
            >
              <div className="absolute top-6 right-6">
                <button 
                  onClick={() => setShowScanner(false)}
                  className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-md border border-black/5 text-ink/40 hover:text-ink transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-1">
                <h2 className="text-3xl font-bold tracking-tight italic text-ink">Scan Peer Node</h2>
                <p className="text-ink/40 text-sm">Aim your camera at a peer's DataLink QR code.</p>
              </div>

              <div id="reader" className="w-full overflow-hidden rounded-3xl border border-black/5 bg-slate-50" style={{ minHeight: '300px' }}></div>

              <button 
                onClick={() => setShowScanner(false)}
                className="w-full py-5 glass-card font-bold rounded-2xl hover:bg-black/5 transition-all text-ink/60 border-black/5"
              >
                CANCEL SCAN
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="relative z-10 max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row justify-between items-center gap-4 text-[9px] uppercase font-mono tracking-[0.3em] text-ink/20 border-t border-black/5">
        <div>&copy; 2026 DATALINK.LABS MESH_PROTOCOL_V1</div>
        <div className="flex gap-10">
          <span className="flex items-center gap-2"><Shield size={12} /> SECURED</span>
          <span className="flex items-center gap-2 text-accent font-bold"><Zap size={12} fill="currentColor" /> PEER_CONNECTED_0XFF</span>
        </div>
      </footer>
    </div>
  );
}

const MeshGraphic = () => (
  <div className="relative w-full h-full flex items-center justify-center p-8">
    <div className="absolute inset-0 grid grid-cols-6 grid-rows-6 opacity-20">
      {Array.from({ length: 36 }).map((_, i) => (
        <div key={i} className="border-[0.5px] border-white/10" />
      ))}
    </div>
    <div className="relative z-10 w-full h-full">
      <svg viewBox="0 0 400 400" className="w-full h-full">
        {/* Connection lines */}
        <motion.path
          d="M 100 100 L 300 150 L 250 300 L 100 250 Z"
          fill="none"
          stroke="url(#gradient)"
          strokeWidth="2"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.5 }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.path
          d="M 50 200 L 150 50 L 350 100 L 300 350 L 100 300 Z"
          fill="none"
          stroke="rgba(6, 108, 244, 0.2)"
          strokeWidth="1"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
        />
        
        {/* Pulsing Nodes */}
        {[
          { x: 100, y: 100 }, { x: 300, y: 150 }, { x: 250, y: 300 }, 
          { x: 100, y: 250 }, { x: 50, y: 200 }, { x: 150, y: 50 },
          { x: 350, y: 100 }, { x: 300, y: 350 }
        ].map((node, i) => (
          <g key={i}>
            <motion.circle
              cx={node.x}
              cy={node.y}
              r="8"
              fill="rgba(6, 108, 244, 0.15)"
              animate={{ scale: [1, 1.5, 1] }}
              transition={{ duration: 2 + i * 0.5, repeat: Infinity }}
            />
            <circle cx={node.x} cy={node.y} r="3" fill="#066CF4" />
          </g>
        ))}

        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#066CF4" />
            <stop offset="100%" stopColor="#5294FF" />
          </linearGradient>
        </defs>
      </svg>
    </div>
    
    <div className="absolute inset-0 flex items-center justify-center">
      <motion.div 
        animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 4, repeat: Infinity }}
        className="w-2/3 h-2/3 bg-accent-light/10 blur-[60px] rounded-full"
      />
    </div>
  </div>
);

const TargetIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </svg>
);
