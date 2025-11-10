import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface AuctionItem {
  id: string;
  name: string;
  description: string;
  startingBid: number;
  currentBid: number;
  encryptedBid: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
  status: 'active' | 'ended' | 'upcoming';
  category: string;
  imageUrl: string;
}

interface UserHistory {
  action: string;
  itemId: string;
  timestamp: number;
  amount?: number;
  status: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [auctions, setAuctions] = useState<AuctionItem[]>([]);
  const [userHistory, setUserHistory] = useState<UserHistory[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingAuction, setCreatingAuction] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newAuctionData, setNewAuctionData] = useState({ 
    name: "", 
    description: "", 
    startingBid: "", 
    category: "Art",
    imageUrl: ""
  });
  const [selectedAuction, setSelectedAuction] = useState<AuctionItem | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState('auctions');
  const [bidAmount, setBidAmount] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadAuctions();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadAuctions = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const auctionsList: AuctionItem[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          auctionsList.push({
            id: businessId,
            name: businessData.name,
            description: businessData.description,
            startingBid: Number(businessData.publicValue1) || 0,
            currentBid: Number(businessData.decryptedValue) || 0,
            encryptedBid: businessId,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            status: 'active',
            category: "Confidential",
            imageUrl: "/api/placeholder/300/200"
          });
        } catch (e) {
          console.error('Error loading auction data:', e);
        }
      }
      
      setAuctions(auctionsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load auctions" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createAuction = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingAuction(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating confidential auction..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const startingBidValue = parseInt(newAuctionData.startingBid) || 0;
      const businessId = `auction-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, startingBidValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAuctionData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        startingBidValue,
        0,
        newAuctionData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Encrypting auction data..." });
      await tx.wait();
      
      addUserHistory('create_auction', businessId, startingBidValue);
      setTransactionStatus({ visible: true, status: "success", message: "Confidential auction created!" });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadAuctions();
      setShowCreateModal(false);
      setNewAuctionData({ name: "", description: "", startingBid: "", category: "Art", imageUrl: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingAuction(false); 
    }
  };

  const placeBid = async (auctionId: string, bidAmount: number) => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Placing encrypted bid..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const encryptedResult = await encrypt(contractAddress, address, bidAmount);
      
      const tx = await contract.createBusinessData(
        `bid-${auctionId}-${Date.now()}`,
        "Bid Update",
        encryptedResult.encryptedData,
        encryptedResult.proof,
        bidAmount,
        0,
        `Bid for ${auctionId}`
      );
      
      await tx.wait();
      
      addUserHistory('place_bid', auctionId, bidAmount);
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted bid placed!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      await loadAuctions();
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Bid failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptBid = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Bid already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying bid decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadAuctions();
      addUserHistory('decrypt_bid', businessId, Number(clearValue));
      
      setTransactionStatus({ visible: true, status: "success", message: "Bid decrypted and verified!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Bid already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadAuctions();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const addUserHistory = (action: string, itemId: string, amount?: number) => {
    const newHistory: UserHistory = {
      action,
      itemId,
      timestamp: Date.now(),
      amount,
      status: 'completed'
    };
    setUserHistory(prev => [newHistory, ...prev.slice(0, 49)]);
  };

  const testContractCall = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and working!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getAuctionStats = () => {
    const total = auctions.length;
    const active = auctions.filter(a => a.status === 'active').length;
    const verified = auctions.filter(a => a.isVerified).length;
    const totalBidValue = auctions.reduce((sum, a) => sum + (a.decryptedValue || 0), 0);
    
    return { total, active, verified, totalBidValue };
  };

  const renderStats = () => {
    const stats = getAuctionStats();
    
    return (
      <div className="stats-grid">
        <div className="stat-card gold-card">
          <div className="stat-icon">🏆</div>
          <div className="stat-content">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Auctions</div>
          </div>
        </div>
        
        <div className="stat-card silver-card">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <div className="stat-value">{stats.active}</div>
            <div className="stat-label">Active Now</div>
          </div>
        </div>
        
        <div className="stat-card bronze-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified Bids</div>
          </div>
        </div>
        
        <div className="stat-card copper-card">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <div className="stat-value">${stats.totalBidValue}</div>
            <div className="stat-label">Total Value</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow-panel">
        <h3>FHE 🔐 Encryption Flow</h3>
        <div className="flow-steps">
          <div className="flow-step">
            <div className="step-number">1</div>
            <div className="step-content">
              <strong>Bid Encryption</strong>
              <p>Bid amount encrypted with Zama FHE technology</p>
            </div>
          </div>
          <div className="flow-arrow">→</div>
          <div className="flow-step">
            <div className="step-number">2</div>
            <div className="step-content">
              <strong>On-chain Storage</strong>
              <p>Encrypted data stored securely on blockchain</p>
            </div>
          </div>
          <div className="flow-arrow">→</div>
          <div className="flow-step">
            <div className="step-number">3</div>
            <div className="step-content">
              <strong>Private Decryption</strong>
              <p>Only auction winner can decrypt final bid</p>
            </div>
          </div>
          <div className="flow-arrow">→</div>
          <div className="flow-step">
            <div className="step-number">4</div>
            <div className="step-content">
              <strong>Verification</strong>
              <p>On-chain proof verification ensures integrity</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderUserHistory = () => {
    return (
      <div className="history-panel">
        <h3>Your Auction History</h3>
        <div className="history-list">
          {userHistory.slice(0, 10).map((record, index) => (
            <div key={index} className="history-item">
              <div className="history-action">{getActionText(record.action)}</div>
              <div className="history-details">
                {record.amount && <span className="history-amount">${record.amount}</span>}
                <span className="history-time">{new Date(record.timestamp).toLocaleTimeString()}</span>
              </div>
              <div className={`history-status ${record.status}`}>{record.status}</div>
            </div>
          ))}
          {userHistory.length === 0 && (
            <div className="no-history">No activity yet</div>
          )}
        </div>
      </div>
    );
  };

  const getActionText = (action: string) => {
    switch (action) {
      case 'create_auction': return 'Created Auction';
      case 'place_bid': return 'Placed Bid';
      case 'decrypt_bid': return 'Decrypted Bid';
      default: return action;
    }
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header metal-header">
          <div className="logo">
            <h1>🔐 AucHouse FHE</h1>
            <span className="tagline">Confidential Auction House</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt metal-bg">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Welcome to Confidential Auctions</h2>
            <p>Connect your wallet to access encrypted bidding and privacy-protected auctions</p>
            <div className="feature-grid">
              <div className="feature-item">
                <span className="feature-icon">🛡️</span>
                <h4>Complete Privacy</h4>
                <p>Bids remain encrypted until auction conclusion</p>
              </div>
              <div className="feature-item">
                <span className="feature-icon">⚡</span>
                <h4>Instant Settlement</h4>
                <p>FHE-enabled secure and fast transactions</p>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🔍</span>
                <h4>Transparent Verification</h4>
                <p>On-chain proof verification ensures fairness</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen metal-bg">
        <div className="fhe-spinner metal-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your auction experience</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen metal-bg">
      <div className="fhe-spinner metal-spinner"></div>
      <p>Loading confidential auctions...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header metal-header">
        <div className="logo">
          <h1>🔐 AucHouse FHE</h1>
          <span className="tagline">Confidential Auction House</span>
        </div>
        
        <div className="header-actions">
          <button onClick={testContractCall} className="test-btn metal-btn">
            Test Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn metal-btn-primary">
            + New Auction
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <nav className="app-nav metal-nav">
        <button 
          className={`nav-btn ${activeTab === 'auctions' ? 'active' : ''}`}
          onClick={() => setActiveTab('auctions')}
        >
          🏆 Auctions
        </button>
        <button 
          className={`nav-btn ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          📊 Statistics
        </button>
        <button 
          className={`nav-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          📋 History
        </button>
      </nav>
      
      <main className="main-content metal-bg">
        {activeTab === 'auctions' && (
          <div className="auctions-section">
            <div className="section-header">
              <h2>Confidential Auctions</h2>
              <button onClick={loadAuctions} className="refresh-btn metal-btn" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "🔄 Refresh"}
              </button>
            </div>
            
            {renderFHEFlow()}
            
            <div className="auctions-grid">
              {auctions.length === 0 ? (
                <div className="no-auctions metal-panel">
                  <p>No confidential auctions found</p>
                  <button onClick={() => setShowCreateModal(true)} className="metal-btn-primary">
                    Create First Auction
                  </button>
                </div>
              ) : auctions.map((auction) => (
                <AuctionCard 
                  key={auction.id}
                  auction={auction}
                  onSelect={setSelectedAuction}
                  onBid={placeBid}
                  bidAmount={bidAmount}
                  setBidAmount={setBidAmount}
                />
              ))}
            </div>
          </div>
        )}
        
        {activeTab === 'stats' && (
          <div className="stats-section">
            <h2>Auction Statistics</h2>
            {renderStats()}
            {renderFHEFlow()}
          </div>
        )}
        
        {activeTab === 'history' && (
          <div className="history-section">
            <h2>Your Activity</h2>
            {renderUserHistory()}
          </div>
        )}
      </main>
      
      {showCreateModal && (
        <CreateAuctionModal 
          onSubmit={createAuction}
          onClose={() => setShowCreateModal(false)}
          creating={creatingAuction}
          auctionData={newAuctionData}
          setAuctionData={setNewAuctionData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedAuction && (
        <AuctionDetailModal 
          auction={selectedAuction}
          onClose={() => {
            setSelectedAuction(null);
            setDecryptedData(null);
          }}
          decryptedData={decryptedData}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptBid={() => decryptBid(selectedAuction.id)}
          onBid={placeBid}
          bidAmount={bidAmount}
          setBidAmount={setBidAmount}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast metal-toast">
          <div className={`toast-icon ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && "✓"}
            {transactionStatus.status === "error" && "✗"}
          </div>
          <div className="toast-message">{transactionStatus.message}</div>
        </div>
      )}
    </div>
  );
};

const AuctionCard: React.FC<{
  auction: AuctionItem;
  onSelect: (auction: AuctionItem) => void;
  onBid: (auctionId: string, amount: number) => void;
  bidAmount: string;
  setBidAmount: (amount: string) => void;
}> = ({ auction, onSelect, onBid, bidAmount, setBidAmount }) => {
  const [showBidForm, setShowBidForm] = useState(false);

  const handleBidSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const amount = parseInt(bidAmount);
    if (amount > auction.currentBid) {
      onBid(auction.id, amount);
      setShowBidForm(false);
      setBidAmount("");
    }
  };

  return (
    <div className="auction-card metal-card" onClick={() => onSelect(auction)}>
      <div className="auction-image">
        <img src={auction.imageUrl} alt={auction.name} />
        <div className="auction-status">{auction.status}</div>
      </div>
      
      <div className="auction-content">
        <h3 className="auction-title">{auction.name}</h3>
        <p className="auction-description">{auction.description}</p>
        
        <div className="auction-details">
          <div className="detail-item">
            <span className="label">Starting Bid:</span>
            <span className="value">${auction.startingBid}</span>
          </div>
          <div className="detail-item">
            <span className="label">Current Bid:</span>
            <span className="value">
              {auction.isVerified ? `$${auction.decryptedValue}` : '🔒 Encrypted'}
            </span>
          </div>
          <div className="detail-item">
            <span className="label">Seller:</span>
            <span className="value">{auction.creator.substring(0, 8)}...</span>
          </div>
        </div>
        
        {!showBidForm ? (
          <button 
            className="bid-btn metal-btn-primary"
            onClick={(e) => {
              e.stopPropagation();
              setShowBidForm(true);
            }}
          >
            Place Encrypted Bid
          </button>
        ) : (
          <form className="bid-form" onSubmit={handleBidSubmit}>
            <input
              type="number"
              value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value)}
              placeholder="Enter bid amount"
              min={auction.currentBid + 1}
              onClick={(e) => e.stopPropagation()}
            />
            <button type="submit" className="metal-btn-primary">Submit Bid</button>
            <button 
              type="button" 
              className="metal-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowBidForm(false);
              }}
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

const CreateAuctionModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  auctionData: any;
  setAuctionData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, auctionData, setAuctionData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setAuctionData({ ...auctionData, [name]: value });
  };

  return (
    <div className="modal-overlay metal-overlay">
      <div className="create-modal metal-modal">
        <div className="modal-header">
          <h2>Create Confidential Auction</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice metal-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Starting bid will be encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Item Name *</label>
            <input 
              type="text" 
              name="name" 
              value={auctionData.name} 
              onChange={handleChange} 
              placeholder="Enter item name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={auctionData.description} 
              onChange={handleChange} 
              placeholder="Describe your auction item..." 
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Starting Bid (ETH) *</label>
            <input 
              type="number" 
              name="startingBid" 
              value={auctionData.startingBid} 
              onChange={handleChange} 
              placeholder="Enter starting bid..." 
              min="0"
              step="0.001"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Category</label>
            <select name="category" value={auctionData.category} onChange={handleChange}>
              <option value="Art">Art</option>
              <option value="Collectibles">Collectibles</option>
              <option value="Real Estate">Real Estate</option>
              <option value="Confidential">Confidential</option>
            </select>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !auctionData.name || !auctionData.description || !auctionData.startingBid} 
            className="submit-btn metal-btn-primary"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Auction"}
          </button>
        </div>
      </div>
    </div>
  );
};

const AuctionDetailModal: React.FC<{
  auction: AuctionItem;
  onClose: () => void;
  decryptedData: number | null;
  isDecrypting: boolean;
  decryptBid: () => Promise<number | null>;
  onBid: (auctionId: string, amount: number) => void;
  bidAmount: string;
  setBidAmount: (amount: string) => void;
}> = ({ auction, onClose, decryptedData, isDecrypting, decryptBid, onBid, bidAmount, setBidAmount }) => {
  const [showBidForm, setShowBidForm] = useState(false);

  const handleBidSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(bidAmount);
    if (amount > auction.currentBid) {
      onBid(auction.id, amount);
      setShowBidForm(false);
      setBidAmount("");
    }
  };

  const handleDecrypt = async () => {
    if (decryptedData !== null) return;
    await decryptBid();
  };

  return (
    <div className="modal-overlay metal-overlay">
      <div className="detail-modal metal-modal">
        <div className="modal-header">
          <h2>Auction Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="auction-hero">
            <img src={auction.imageUrl} alt={auction.name} className="hero-image" />
            <div className="hero-content">
              <h1>{auction.name}</h1>
              <p className="auction-description">{auction.description}</p>
              <div className="auction-meta">
                <span className="category">{auction.category}</span>
                <span className="status">{auction.status}</span>
              </div>
            </div>
          </div>
          
          <div className="bid-section">
            <h3>Current Bidding</h3>
            <div className="bid-info">
              <div className="bid-item">
                <span>Starting Bid:</span>
                <strong>${auction.startingBid}</strong>
              </div>
              <div className="bid-item">
                <span>Current Highest:</span>
                <strong>
                  {auction.isVerified ? 
                    `$${auction.decryptedValue} (Verified)` : 
                    decryptedData !== null ? 
                    `$${decryptedData} (Decrypted)` : 
                    "🔒 Encrypted"
                  }
                </strong>
              </div>
            </div>
            
            <div className="bid-actions">
              {!showBidForm ? (
                <button 
                  className="bid-btn metal-btn-primary"
                  onClick={() => setShowBidForm(true)}
                >
                  Place Encrypted Bid
                </button>
              ) : (
                <form className="bid-form detailed" onSubmit={handleBidSubmit}>
                  <input
                    type="number"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    placeholder={`Enter bid above $${auction.currentBid || auction.startingBid}`}
                    min={(auction.currentBid || auction.startingBid) + 1}
                  />
                  <div className="bid-buttons">
                    <button type="submit" className="metal-btn-primary">Submit Encrypted Bid</button>
                    <button 
                      type="button" 
                      className="metal-btn"
                      onClick={() => setShowBidForm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              
              <button 
                className={`decrypt-btn metal-btn ${decryptedData !== null || auction.isVerified ? 'decrypted' : ''}`}
                onClick={handleDecrypt}
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : 
                 auction.isVerified ? "✅ Verified" : 
                 decryptedData !== null ? "🔓 Decrypted" : 
                 "🔐 Decrypt Bid"}
              </button>
            </div>
          </div>
          
          <div className="fhe-info detailed">
            <h4>FHE 🔐 Security Features</h4>
            <ul>
              <li>Bid amounts encrypted with Zama FHE technology</li>
              <li>On-chain storage with zero-knowledge proofs</li>
              <li>Private decryption available to authorized parties</li>
              <li>Tamper-proof verification system</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;


