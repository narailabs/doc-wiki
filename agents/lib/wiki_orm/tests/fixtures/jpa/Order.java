package com.example.model;

import javax.persistence.*;

@Entity
@Table(name = "orders")
public class Order {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "total_amount")
    private Double totalAmount;

    @ManyToOne
    @JoinColumn(name = "user_id")
    private User user;
}
