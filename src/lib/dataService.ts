import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  increment, 
  collection, 
  query, 
  where, 
  getDocs, 
  runTransaction,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase';

export interface UserProfile {
  uid: string;
  phoneNumber: string;
  displayName: string;
  balanceMB: number;
  lastActive: Timestamp;
  carrier: 'Jio' | 'Airtel' | 'Vi' | 'BSNL' | 'Other';
}

export interface DataTransaction {
  id: string;
  fromUid: string;
  toUid: string;
  fromPhone: string;
  toPhone: string;
  fromCarrier?: string;
  toCarrier?: string;
  amountMB: number;
  timestamp: Timestamp;
  status: 'completed' | 'pending' | 'failed';
}

export async function findUserByPhone(phoneNumber: string): Promise<string | null> {
  try {
    const q = query(collection(db, 'users'), where('phoneNumber', '==', phoneNumber));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) return null;
    return querySnapshot.docs[0].id;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'users');
    return null;
  }
}

export async function transferData(targetPhone: string, amountMB: number) {
  const currentUserId = auth.currentUser?.uid;
  if (!currentUserId) throw new Error('User not authenticated');

  const senderDocRef = doc(db, 'users', currentUserId);
  
  try {
    const targetUid = await findUserByPhone(targetPhone);
    
    if (!targetUid) throw new Error('Recipient not found on DataLink network');
    if (targetUid === currentUserId) throw new Error('Cannot send data to yourself');

    const receiverDocRef = doc(db, 'users', targetUid);
    const transactionDocRef = doc(collection(db, 'transactions'));

    return await runTransaction(db, async (transaction) => {
      const senderSnap = await transaction.get(senderDocRef);
      if (!senderSnap.exists()) throw new Error('Sender profile not found');
      
      const senderData = senderSnap.data() as UserProfile;
      if (senderData.balanceMB < amountMB) {
        throw new Error('Insufficient data balance');
      }

      const receiverSnap = await transaction.get(receiverDocRef);
      if (!receiverSnap.exists()) throw new Error('Receiver profile not found');

      // Update balances
      transaction.update(senderDocRef, {
        balanceMB: increment(-amountMB),
        lastActive: serverTimestamp()
      });

      transaction.update(receiverDocRef, {
        balanceMB: increment(amountMB)
      });

      // Create transaction log
      transaction.set(transactionDocRef, {
        fromUid: currentUserId,
        toUid: targetUid,
        fromPhone: senderData.phoneNumber,
        toPhone: targetPhone,
        fromCarrier: senderData.carrier,
        toCarrier: receiverSnap.data()?.carrier,
        amountMB,
        timestamp: serverTimestamp(),
        status: 'completed'
      });

      return { amountMB, toPhone: targetPhone };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'transfer');
  }
}

export async function getTransactionHistory() {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];

  try {
    const qFrom = query(collection(db, 'transactions'), where('fromUid', '==', uid));
    const qTo = query(collection(db, 'transactions'), where('toUid', '==', uid));

    const [fromSnap, toSnap] = await Promise.all([getDocs(qFrom), getDocs(qTo)]);
    
    const results = [
      ...fromSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      ...toSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    ] as DataTransaction[];

    return results.sort((a, b) => {
      const timeA = a.timestamp?.toMillis() || 0;
      const timeB = b.timestamp?.toMillis() || 0;
      return timeB - timeA;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'transactions');
    return [];
  }
}
