# Change Document for v2 Update of @cat-protocol/cat-sdk

---

## **Version Overview**

The v2 update of `@cat-protocol/cat-sdk` introduces significant upgrades to enhance the development experience, improve security, and expand contract functionality. These updates bring a more streamlined SDK syntax, new features for better usability, and optimizations that reduce contract size and complexity.

---

## **Key Features and Updates**

### **1. Development Tool Upgrades**
The development tools have been significantly improved to simplify the contract writing process and enhance efficiency:

1. **`stateProp` uses `hash160` for computation**  
   - Avoids slicing and windowing issues when handling large states.  
   - Provides a more secure and efficient way to manage state properties.

2. **Introduction of `ctx`**  
   - Simplifies the development process by lowering the learning curve for new developers.  
   - Developers can now access context-related information more intuitively.

3. **Automatic injection of `stateHash` methods**  
   - Eliminates the need for manual serialization and deserialization code.  
   - Reduces boilerplate code and improves development speed.

---

### **2. Guard Enhancements**

1. **InputStateProof for Direct Token State Access**  
   - The `guard` now supports `InputStateProof`, enabling direct reading of token states.  
   - Simplifies token-related operations by reducing the need for intermediate steps.

2. **Support for 4 Types of Token Transfers**  
   - The `guard` now supports up to 4 types of token transfers within a single contract.  
   - This feature provides developers with more flexibility and increases the number of usable input options for contracts.

---

### **3. Security Updates**

- Enhanced security through the use of `hash160` for state property computations, reducing potential vulnerabilities related to state manipulation.
- Improved token state management via `InputStateProof`, ensuring accurate and reliable state reads.

---

### **4. New SDK Syntax**

- The introduction of `ctx` and automatic `stateHash` injection represents a shift towards a cleaner, simpler SDK syntax.  
- This update reduces the technical barriers for developers and allows for faster prototyping and deployment of contracts.

---

### **5. Contract Size Optimization**

- Comparison of v1 and v2 contract sizes shows a reduction in overall size due to the removal of manual serialization/deserialization code and other optimizations.  
- Smaller contract sizes lead to lower transaction costs and better performance on the blockchain.

---

## **Comparison of v1 and v2**

| Feature                        | v1                                  | v2                                  |
|--------------------------------|-------------------------------------|-------------------------------------|
| `stateProp` Calculation        | Manual slicing and windowing        | Automatic `hash160` computation     |
| Context Handling               | Limited and complex                 | Simplified with `ctx`               |
| State Hash Management          | Manual serialization/deserialization | Automatic injection of `stateHash` |
| Token State Access             | Indirect                            | Direct with `InputStateProof`       |
| Token Transfer Support         | Limited                             | Supports 4 types                    |
| Contract Size                  | Larger                              | Smaller                             |

---

## **Benefits of v2 Update**

1. **Ease of Development**  
   - Simplifies the development process with automatic methods and new syntax.  
   - Reduces boilerplate code, allowing developers to focus on business logic.

2. **Enhanced Functionality**  
   - Supports more token transfer options, making contracts more versatile.  
   - Improves token state management with direct access.

3. **Improved Security**  
   - Utilizes `hash160` and InputStateProof for robust and secure state handling.

4. **Cost Efficiency**  
   - Smaller contract sizes reduce transaction fees and improve execution efficiency.

---

## **Conclusion**

The v2 update of `@cat-protocol/cat-sdk` is a major milestone in improving the development experience, enhancing security, and expanding the capabilities of smart contracts. With these updates, developers can build more powerful and efficient contracts with less effort, while also benefiting from reduced costs and better performance.